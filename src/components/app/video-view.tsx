"use client";

import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { AnalysisSummary } from "@/lib/comment-categories";

import { useApp, type Video } from "./app-shell";
import { CommentList } from "./comment-list";
import { formatDate } from "./format";
import { Thumbnail } from "./thumbnail";

/** 残りのコメントを取得中・分析中のとき、状況を確かめる間隔（ミリ秒）【確定】 */
const STATUS_POLL_MS = 3000;

type VideoDetail = { video: Video; analysis: AnalysisSummary };

// 中央の枠の ②分析結果（要件定義書4.3）：動画の情報と、分析の進み具合と、コメント一覧
export function VideoView({ videoId }: { videoId: string }) {
  const { reloadVideos } = useApp();
  const router = useRouter();
  // 右の枠のランキングで選んだグループ（/videos/:id?group=…）。選ぶとコメント一覧がそのグループのコメントだけになる。
  // URL に持たせるのは、再読み込みやブラウザの「戻る」で、同じ表示に戻れるようにするため（要件定義書4.1と同じ考え方）。
  const group = useSearchParams().get("group");
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  // コメント一覧を読み込み直すための番号。増やすと、一覧が最初から読み込み直される。
  const [listVersion, setListVersion] = useState(0);
  // 一覧を最後に読み込んだときの、分析済みのコメント数。これより増えたら「新しく分析されたコメント」がある。
  const [shownAnalyzed, setShownAnalyzed] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // 数秒ごとの確認で、前回の状況と比べるために使う（確認の処理は作り直さずに、最新の値だけを読む）。
  const detailRef = useRef(detail);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  // 削除・期限切れの動画は、エラーを出さずに ①URL入力 に戻す（要件定義書3.3）。
  const handleNotFound = useCallback(() => {
    router.replace("/");
    reloadVideos();
  }, [router, reloadVideos]);

  /** 一覧を最初から読み込み直す（新しく分析されたコメントも出る）。 */
  const reloadList = useCallback((analyzed: number) => {
    setShownAnalyzed(analyzed);
    setListVersion((v) => v + 1);
  }, []);

  // 開いたときに、動画の情報を読む。
  useEffect(() => {
    let cancelled = false;
    fetchVideo(videoId).then((result) => {
      if (cancelled || result === null) return;
      if (result === "not_found") return handleNotFound();
      setDetail(result);
      setShownAnalyzed(result.analysis.analyzed);
    });
    return () => {
      cancelled = true;
    };
  }, [videoId, handleNotFound]);

  // 残りのコメントを取得中（fetching）か、分析中（analyzing）の間は、数秒ごとに状況を確かめる。
  const busy =
    detail?.video.fetch_status === "fetching" || detail?.analysis.status === "analyzing";
  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const result = await fetchVideo(videoId);
      if (cancelled || result === null) return;
      if (result === "not_found") return handleNotFound();
      // 取得や分析が終わったとき、または、まだ1件も表示していないときに分析済みのコメントが出てきたときは、
      // 一覧を自動で読み込み直す。それ以外で増えた分は、ボタン（「新しく分析された◯件を表示する」）で読み込む
      // （読んでいる途中で一覧が勝手に入れ替わらないようにするため）。
      const previous = detailRef.current;
      const finished =
        (previous?.video.fetch_status === "fetching" && result.video.fetch_status !== "fetching") ||
        (previous?.analysis.status === "analyzing" && result.analysis.status !== "analyzing");
      const firstResults = (previous?.analysis.analyzed ?? 0) === 0 && result.analysis.analyzed > 0;
      if (finished || firstResults) reloadList(result.analysis.analyzed);
      setDetail(result);
    }, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [busy, videoId, handleNotFound, reloadList]);

  /** 「分析をやり直す」（要件定義書15.2） */
  async function handleRetry() {
    setRetrying(true);
    try {
      const response = await fetch(`/api/videos/${videoId}/analyze`, { method: "POST" });
      if (response.status === 404) return handleNotFound();
      const result = await fetchVideo(videoId);
      if (result && result !== "not_found") setDetail(result);
    } finally {
      setRetrying(false);
    }
  }

  if (!detail) {
    return <p className="p-8 text-sm text-muted-foreground">読み込み中…</p>;
  }
  const { video, analysis } = detail;
  const newlyAnalyzed = analysis.analyzed - shownAnalyzed;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex gap-4">
        <Thumbnail url={video.thumbnail_url} className="w-48" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold">{video.title}</h1>
          {video.published_at && (
            <p className="text-sm text-muted-foreground">公開日：{formatDate(video.published_at)}</p>
          )}
          <a
            href={`https://www.youtube.com/watch?v=${video.video_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            YouTubeで開く
          </a>
        </div>
      </header>

      {video.fetch_status === "fetching" && (
        <Notice icon={<Loader2 className="size-4 animate-spin" />}>
          残りのコメントを取得しています。
        </Notice>
      )}
      {video.fetch_status === "failed" && (
        <Notice icon={<TriangleAlert className="size-4" />}>
          一部のコメントを取得できませんでした。取得できた分を表示しています。
        </Notice>
      )}
      {analysis.status === "analyzing" && (
        <Notice icon={<Loader2 className="size-4 animate-spin" />}>
          <span className="flex-1">
            コメントを分析しています（{analysis.analyzed}／{analysis.total}件）。
            分析が済んだコメントから表示します。
          </span>
          {newlyAnalyzed > 0 && shownAnalyzed > 0 && (
            <Button variant="outline" size="sm" onClick={() => reloadList(analysis.analyzed)}>
              <RefreshCw />
              新しく分析された{newlyAnalyzed}件を表示する
            </Button>
          )}
        </Notice>
      )}
      {analysis.status === "failed" && (
        <Notice icon={<TriangleAlert className="size-4" />}>
          <span className="flex-1">
            一部のコメントを分析できませんでした（{analysis.analyzed}／{analysis.total}件が分析済み）。
            分析できなかったコメントは「すべて」タブで確認できます。
          </span>
          <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
            {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            分析をやり直す
          </Button>
        </Notice>
      )}

      <CommentList
        videoId={video.id}
        version={listVersion}
        counts={analysis.counts}
        analyzing={analysis.status === "analyzing"}
        group={group}
      />
    </div>
  );
}

/** 進み具合などのお知らせ（中央の枠の上部に出す帯） */
function Notice({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
      {icon}
      {children}
    </div>
  );
}

/** 動画の情報と分析の進み具合を読む。見つからなければ "not_found"、通信などの失敗は null（次の機会に読み直す）。 */
async function fetchVideo(videoId: string): Promise<VideoDetail | "not_found" | null> {
  try {
    const response = await fetch(`/api/videos/${videoId}`, { cache: "no-store" });
    if (response.status === 404) return "not_found";
    if (!response.ok) return null;
    return (await response.json()) as VideoDetail;
  } catch {
    return null;
  }
}
