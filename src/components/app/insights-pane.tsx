"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { VideoAdvice } from "@/lib/advice";
import type { RankingItem, VideoRankings } from "@/lib/rankings";
import { cn } from "@/lib/utils";

// 右の枠（要件定義書4.4）。
// ランキング（スライス4）：開いている動画の、指摘・要望ランキングと質問ランキングを、1〜3位まで出す。
//   項目を選ぶと、中央の枠のコメント一覧が、そのグループのコメントだけになる（URL の ?group=）。
//   選んだ項目をもう一度選ぶと、元の一覧（タブ）に戻る。
// AIアドバイス（スライス5）：分析が終わったときに作られる。分析中は、ランキングと同じく数秒ごとに読み直す。

/** 分析中に、ランキングとアドバイスを読み直す間隔（ミリ秒）。中央の枠の進み具合の確認と同じ間隔にする。 */
const RANKINGS_POLL_MS = 3000;

export function InsightsPane() {
  // 右の枠は、どの画面でも共通の枠（app-shell.tsx）なので、開いている動画を URL（/videos/:id）から読む。
  const videoId = usePathname().match(/^\/videos\/([^/]+)/)?.[1] ?? null;
  const rankings = usePolling<VideoRankings>(videoId, "rankings");
  const advice = usePolling<VideoAdvice>(videoId, "advice");
  const selected = useSearchParams().get("group");

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">インサイト</h2>
      <RankingSection
        title="指摘・要望ランキング"
        videoId={videoId}
        rankings={rankings}
        items={rankings?.feedbackRequest}
        selected={selected}
      />
      <RankingSection
        title="質問ランキング"
        videoId={videoId}
        rankings={rankings}
        items={rankings?.question}
        selected={selected}
      />
      <AdviceSection videoId={videoId} advice={advice} />
    </div>
  );
}

function RankingSection({
  title,
  videoId,
  rankings,
  items,
  selected,
}: {
  title: string;
  videoId: string | null;
  rankings: VideoRankings | null;
  items: RankingItem[] | undefined;
  /** 選んでいるグループの id */
  selected: string | null;
}) {
  let message: string | null = null;
  if (!videoId) message = "動画を開くと表示されます";
  else if (!rankings || !items) message = "読み込み中…";
  else if (items.length === 0) {
    message = rankings.status === "analyzing" ? "コメントを分析しています…" : "該当するコメントはありません";
  }

  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {message ? (
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1">
          {items!.map((item) => {
            const active = item.id === selected;
            return (
              <li key={item.id}>
                <Link
                  // 選んでいる項目をもう一度選ぶと、絞り込みを解除する。
                  href={active ? `/videos/${videoId}` : `/videos/${videoId}?group=${item.id}`}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "-mx-2 flex items-baseline gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                    active && "bg-secondary font-medium hover:bg-secondary",
                  )}
                >
                  <span className="w-8 shrink-0 font-semibold">{item.rank}位</span>
                  {/* 代表論点は AI が作った文なので、HTML としてではなく文字として表示する（React の既定。要件定義書16章） */}
                  <span className="min-w-0 flex-1 break-words">{item.text}</span>
                  <span className="shrink-0 text-muted-foreground">{item.count}件</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** アドバイスの状態ごとに、中身の代わりに出す文 */
const ADVICE_MESSAGES: Record<Exclude<VideoAdvice["state"], "ready">, string> = {
  waiting: "コメントの分析が終わると、アドバイスを作ります…",
  failed: "アドバイスを作れませんでした。中央の「分析をやり直す」から、もう一度作れます",
  too_few: "分析できたコメントが少ないため、アドバイスは作っていません",
  unavailable: "この動画のアドバイスはありません",
};

function AdviceSection({ videoId, advice }: { videoId: string | null; advice: VideoAdvice | null }) {
  let message: string | null = null;
  if (!videoId) message = "動画を開くと表示されます";
  else if (!advice) message = "読み込み中…";
  else if (advice.state !== "ready") message = ADVICE_MESSAGES[advice.state];
  else if (!advice.advice) message = ADVICE_MESSAGES.unavailable;

  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-medium">AIアドバイス</h3>
      {message ? (
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      ) : (
        // AI が作った文なので、HTML としてではなく文字として表示する（React の既定。要件定義書16章）。
        // 本文は「■ 見出し」「・項目」の行からなるので、改行をそのまま見せる（whitespace-pre-wrap）。
        <div className="mt-2 flex flex-col gap-3 text-sm">
          <p className="font-medium">{advice!.advice!.summary}</p>
          <p className="whitespace-pre-wrap break-words leading-relaxed">{advice!.advice!.text}</p>
          <p className="text-xs text-muted-foreground">
            コメントの分析結果をもとに AI が作ったアドバイスです。参考の一つとしてご覧ください。
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * 動画のランキングかアドバイスを読む（GET /api/videos/:id/rankings、/advice）。
 * 分析が終わるまでは、数秒ごとに読み直す（分析が進むと、ランキングが変わり、終わるとアドバイスができるため）。
 */
function usePolling<T extends { status: string }>(
  videoId: string | null,
  resource: "rankings" | "advice",
): T | null {
  // どの動画のデータかも一緒に持ち、別の動画に切り替えたときに、前の動画のデータを出さないようにする。
  const [state, setState] = useState<{ videoId: string; data: T } | null>(null);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      const data = await fetchResource<T>(videoId!, resource);
      if (cancelled) return;
      // 見つからない（削除・期限切れ）ときは、中央の枠が①URL入力に戻すので、ここでは読み直さない。
      if (data === "not_found") return;
      if (data) setState({ videoId: videoId!, data });
      // 分析が終わる（done）までは読み直す。失敗（failed）の間も読み直すのは、
      // 中央の枠の「分析をやり直す」で分析が再開したときに、こちらにも反映するため。
      // 通信の失敗（null）のときも、状況が分からないので、もう一度読む。
      if (!data || data.status !== "done") {
        timer = setTimeout(load, RANKINGS_POLL_MS);
      }
    }
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [videoId, resource]);

  return state && state.videoId === videoId ? state.data : null;
}

/** 読む。見つからなければ "not_found"、通信などの失敗は null。 */
async function fetchResource<T>(
  videoId: string,
  resource: "rankings" | "advice",
): Promise<T | "not_found" | null> {
  try {
    const response = await fetch(`/api/videos/${videoId}/${resource}`, { cache: "no-store" });
    if (response.status === 404) return "not_found";
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
