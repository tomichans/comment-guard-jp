"use client";

import {
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquare,
  Search,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

import {
  ALL_TAB_WARNING,
  COMMENT_TABS,
  DEFAULT_COMMENT_TAB,
  type CommentTab,
} from "@/lib/comment-categories";
import {
  COMMENT_SEARCH_MAX_LENGTH,
  COMMENT_SORTS,
  DEFAULT_COMMENT_SORT,
  isCommentSort,
  type CommentSort,
} from "@/lib/comment-list";
import type { Tables } from "@/lib/database.types";

import { formatDate } from "./format";

// =============================================================
// コメント一覧（要件定義書4.3、17.1）
//
// - 分類のタブ（ポジティブ、質問、指摘・要望、否定的意見、スパム、要注意・攻撃的、すべて）
//   「すべて」を選ぶときだけ、警告を出して確認する。誤って選ばないよう、一部のタブは半透明にする
// - 並び順の切り替えと、本文の検索
// - 最初に50スレッドを表示し、一番下までスクロールすると、次の50スレッドを読み込む
// - 親コメントと返信をスレッドの形で表示する。返信は最初は折り畳む
//
// コメント本文は、React の通常の表示（{text}）で出す。HTML として描画しないので、
// 本文に <script> などが含まれていても、ただの文字として表示される（要件定義書16章）。
// =============================================================

type Comment = Tables<"comments"> & {
  /** 分析結果。分析に失敗した動画の「すべて」タブでは、分析されていないコメント（null）も出る。 */
  analysis: Pick<Tables<"comment_analysis">, "primary_category" | "labels" | "review_required"> | null;
};
type CommentThread = Comment & { replies: Comment[] };
type ThreadPage = { threads: CommentThread[]; total: number; nextOffset: number | null };

/**
 * @param version 増えたら、一覧を最初から読み込み直す（残りのコメントの取得・分析が終わったときなど）
 * @param counts タブごとの件数
 * @param analyzing 分析中か（一覧が空のときの案内を変える）
 */
export function CommentList({
  videoId,
  version,
  counts,
  analyzing,
}: {
  videoId: string;
  version: number;
  counts: Record<CommentTab, number>;
  analyzing: boolean;
}) {
  const [tab, setTab] = useState<CommentTab>(DEFAULT_COMMENT_TAB);
  const [sort, setSort] = useState<CommentSort>(DEFAULT_COMMENT_SORT);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(input.trim());
  }

  function handleTab(next: CommentTab) {
    // 「すべて」には攻撃的なコメントやスパムも出るので、選ぶ前に確認する（要件定義書4.3）。
    // 「要注意・攻撃的」タブは、意図して見に行く場所なので確認しない。
    if (next === "all" && tab !== "all" && !window.confirm(ALL_TAB_WARNING)) return;
    setTab(next);
  }

  return (
    <section className="flex flex-col gap-4" aria-label="コメント一覧">
      <div role="tablist" aria-label="コメントの分類" className="flex flex-wrap gap-1 border-b pb-2">
        {COMMENT_TABS.map(({ value, label, dimmed }) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            variant={tab === value ? "secondary" : "ghost"}
            size="sm"
            onClick={() => handleTab(value)}
            className={cn(dimmed && tab !== value && "opacity-50")}
          >
            {label}
            <span className="text-xs text-muted-foreground">{counts[value]}</span>
          </Button>
        ))}
      </div>
      <div className="flex gap-2">
        <form onSubmit={handleSearch} className="relative flex-1" role="search">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // 検索語を消したら、すぐに全件の表示に戻す。
              if (e.target.value === "") setQuery("");
            }}
            placeholder="コメントを検索（Enterで検索）"
            aria-label="コメントを検索"
            maxLength={COMMENT_SEARCH_MAX_LENGTH}
            className="h-9 pl-8"
          />
        </form>
        <select
          value={sort}
          onChange={(e) => isCommentSort(e.target.value) && setSort(e.target.value)}
          aria-label="並び順"
          className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          {Object.entries(COMMENT_SORTS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* key：タブ・並び順・検索語・version のどれかが変わったら、一覧を作り直して最初から読み込む */}
      <Threads
        key={`${tab}|${sort}|${query}|${version}`}
        videoId={videoId}
        tab={tab}
        sort={sort}
        query={query}
        analyzing={analyzing}
      />
    </section>
  );
}

function Threads({
  videoId,
  tab,
  sort,
  query,
  analyzing,
}: {
  videoId: string;
  tab: CommentTab;
  sort: CommentSort;
  query: string;
  analyzing: boolean;
}) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  // 次に読み込む位置。null なら最後まで読み込んだ。
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // 読み込み中に、同じページをもう一度読み込まないための印
  const busy = useRef(false);
  // 画面から消えた（並び順を変えたなど）後に届いた結果を、捨てるための印
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 一覧の一番下に置いた目印（sentinel）が画面に入ったら、続きを読み込む。
  // 読み込むたびに nextOffset が変わり、目印の見張りを作り直す。
  // そのとき目印がまだ画面に入っていれば（画面が縦に長いときなど）、すぐに次も読み込む。
  useEffect(() => {
    const target = sentinel.current;
    if (!target || nextOffset === null || failed) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || busy.current) return;
        observer.disconnect();
        busy.current = true;
        setLoading(true);
        fetchThreadPage(videoId, tab, sort, query, nextOffset)
          .then((page) => {
            if (!alive.current) return;
            setThreads((previous) => [...previous, ...page.threads]);
            setTotal(page.total);
            setNextOffset(page.nextOffset);
          })
          .catch(() => {
            if (alive.current) setFailed(true);
          })
          .finally(() => {
            busy.current = false;
            if (alive.current) setLoading(false);
          });
      },
      // 一番下に着く少し前（300px手前）から読み込み始める。
      { rootMargin: "300px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [videoId, tab, sort, query, nextOffset, failed]);

  return (
    <>
      {total !== null && (
        <p className="text-sm text-muted-foreground">
          {query ? `「${query}」を含むコメント：${total}件` : `コメント：${total}件`}
        </p>
      )}
      {total === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {query
            ? "一致するコメントはありません"
            : analyzing
              ? "分析が済んだコメントから、ここに表示されます"
              : "この分類のコメントはありません"}
        </p>
      )}
      <ul className="flex flex-col divide-y">
        {threads.map((thread) => (
          <ThreadItem key={thread.id} thread={thread} />
        ))}
      </ul>
      <div ref={sentinel} />
      {loading && (
        <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          読み込み中…
        </p>
      )}
      {failed && (
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-sm text-destructive">コメントを読み込めませんでした</p>
          <Button variant="outline" size="sm" onClick={() => setFailed(false)}>
            もう一度読み込む
          </Button>
        </div>
      )}
    </>
  );
}

function ThreadItem({ thread }: { thread: CommentThread }) {
  const [open, setOpen] = useState(false);
  const stored = thread.replies.length;
  // YouTube 上の返信の総数。アプリに保存されるのは、そのうち一部だけ（要件定義書7.3）。
  const totalReplies = thread.reply_count ?? stored;

  return (
    <li className="flex flex-col gap-2 py-4">
      <CommentBody comment={thread} replyCount={totalReplies} />
      {stored > 0 && (
        <div className="flex flex-col gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? <ChevronUp /> : <ChevronDown />}
            {open ? "返信を閉じる" : `返信を表示（${stored}件）`}
          </Button>
          {open && (
            <ul className="flex flex-col gap-3 border-l-2 pl-4">
              {thread.replies.map((reply) => (
                <li key={reply.id}>
                  <CommentBody comment={reply} reply />
                </li>
              ))}
              {totalReplies > stored && (
                <li className="text-xs text-muted-foreground">
                  ほかに{totalReplies - stored}件の返信があります（YouTubeで確認できます）
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * @param reply 返信か。返信は親コメントのタブに出るので、攻撃的な返信には「要注意」の印を付ける【確定】
 */
function CommentBody({
  comment,
  replyCount,
  reply = false,
}: {
  comment: Comment;
  replyCount?: number;
  reply?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{comment.author ?? "（名前なし）"}</span>
        {comment.posted_at && <span>{formatDate(comment.posted_at)}</span>}
        {reply && comment.analysis?.primary_category === "harmful" && (
          <Mark className="bg-destructive/10 text-destructive">
            <TriangleAlert className="size-3" />
            要注意
          </Mark>
        )}
        {/* 分析に失敗した動画では、分析されていないコメントも出るので、そのことが分かるようにする。 */}
        {!comment.analysis && <Mark className="bg-muted">未分析</Mark>}
      </p>
      <p className="text-sm break-words whitespace-pre-wrap">{comment.comment_text}</p>
      <p className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ThumbsUp className="size-3" />
          {comment.like_count ?? 0}
        </span>
        {replyCount !== undefined && (
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3" />
            {replyCount}
          </span>
        )}
      </p>
    </div>
  );
}

function Mark({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium", className)}>
      {children}
    </span>
  );
}

async function fetchThreadPage(
  videoId: string,
  tab: CommentTab,
  sort: CommentSort,
  query: string,
  offset: number,
): Promise<ThreadPage> {
  const params = new URLSearchParams({ tab, sort, offset: String(offset) });
  if (query) params.set("q", query);
  const response = await fetch(`/api/videos/${videoId}/comments?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`コメント一覧の取得に失敗（${response.status}）`);
  return (await response.json()) as ThreadPage;
}
