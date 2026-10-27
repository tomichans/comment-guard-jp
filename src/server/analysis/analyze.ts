import "server-only";

import { CLASSIFY_BATCH_SIZE, CLASSIFY_CONCURRENCY } from "@/lib/config/analysis";
import type { Tables } from "@/lib/database.types";
import { findOwnedVideo, type Owner } from "@/server/access";
import { createAdminClient, type AdminClient } from "@/server/supabase/admin";
import type { UsageContext } from "@/server/usage";

import { openAiAnalysis, type AnalysisAi } from "./ai";
import { groupPendingComments } from "./group-comments";
import { effectiveAnalysisStatus } from "./status";
import { decideAnalysis, isHarmfulByNgWord, matchNgWords, type NgWord } from "./rules";

// =============================================================
// コメントの分析（要件定義書5章、8章、9章）
//
// 流れ（1動画分）
//   1. まだ分析されていないコメントを、最大 50件×4 まとまり 読む（comments_to_analyze）
//   2. まとまりごとに、並べて分析する（analyzeBatch）
//      a. NGワードを探す。severity=5 にヒットしたものは、AI を通さずに harmful
//      b. 残りを、Moderation API と分類 AI に送る（2つは同時に送る）
//      c. 結果を合わせて最終的な分類を決め、comment_analysis に保存する
//   3. 分類できた分を、似たコメントのグループに振り分ける（group-comments.ts。要件定義書10章）
//   4. 1 に戻る。分析されていないコメントがなくなったら、analysis_status を done にする
//
// 裏での実行方法【確定】：コメントの残りの取得と同じく、Next.js の after() で、レスポンスを返した後に実行する。
// ここの関数は「実行する関数」を作るだけで、after() に渡すのは API Route（呼び出し側）の役目。
//
// 失敗したとき【確定】（要件定義書15.2）：analysis_status を failed にする。分析済みの結果は残す。
// 画面の「分析をやり直す」から、まだ分析されていないコメントだけを分析し直せる（retryAnalysis）。
// =============================================================

type Video = Tables<"videos">;
type Comment = Tables<"comments">;

/**
 * 動画の登録後に、裏で行う処理（コメントの残りの取得と、分析）。
 * 残りの取得（fetchRemaining）と分析は同時に進める。最初の100スレッドを分析している間に、残りを取得しておき、
 * 取得が終わった分も続けて分析する。こうすると、最初の100スレッドの結果が早く画面に出る。
 */
export function runAfterRegister(
  video: Video,
  fetchRemaining: (() => Promise<void>) | null,
  ai: AnalysisAi = openAiAnalysis,
): () => Promise<void> {
  return () =>
    analyzeVideoComments(video, {
      ai,
      fetching: fetchRemaining ? fetchRemaining() : null,
    });
}

/**
 * 動画のコメントのうち、まだ分析されていないものをすべて分析し、最後に analysis_status を done（失敗なら failed）にする。
 * fetching を渡すと、分析するコメントがなくなっても、その取得が終わるまで待ってから、取得した分も分析する。
 */
export async function analyzeVideoComments(
  video: Pick<Video, "id" | "user_id" | "guest_id">,
  { ai = openAiAnalysis, fetching = null }: { ai?: AnalysisAi; fetching?: Promise<void> | null } = {},
): Promise<void> {
  const admin = createAdminClient();
  const ctx: UsageContext = {
    videoId: video.id,
    userId: video.user_id,
    guestId: video.guest_id,
    ipHash: null,
  };
  let fetchDone = fetching === null;
  void fetching?.finally(() => {
    fetchDone = true;
  });

  let status: "done" | "failed" = "done";
  try {
    const ngWords = await loadNgWords(admin);
    for (;;) {
      const { data: comments, error } = await admin.rpc("comments_to_analyze", {
        p_video_id: video.id,
        p_limit: CLASSIFY_BATCH_SIZE * CLASSIFY_CONCURRENCY,
      });
      if (error) throw error;
      const batches = chunk(comments, CLASSIFY_BATCH_SIZE);
      // 1つのまとまりが失敗しても、他のまとまりは最後まで終わらせてから止める（分析できた分は保存しておく）。
      const settled = await Promise.allSettled(
        batches.map((batch) => analyzeBatch(admin, batch, ngWords, ai, ctx)),
      );
      // 分類できた分を、グループに振り分ける（要件定義書10章）。1まわりごとに行うので、ランキングも少しずつ出てくる。
      // 分類するコメントがない回も呼ぶ。前回の分析で、分類は済んだがグループに入っていないコメントを拾うため。
      await groupPendingComments(admin, video.id, ai, ctx);
      const failure = settled.find((r) => r.status === "rejected");
      if (failure) throw failure.reason;

      if (comments.length === 0) {
        if (!fetchDone) {
          await fetching;
          continue;
        }
        break;
      }
    }
  } catch (e) {
    // 23503 = foreign_key_violation。分析中にユーザーが動画を削除すると、結果を保存しようとした時点でこのエラーになる。
    // 失敗ではないので、ログを出さずに止める（コメントの残りの取得と同じ。src/server/videos/register.ts）。
    if ((e as { code?: string }).code === "23503") {
      await fetching;
      return;
    }
    status = "failed";
    // エラーの種類だけを記録する（コメント本文や API キーはログに出さない。要件定義書16章）。
    console.error("[analyze-comments] コメントの分析に失敗しました", {
      videoId: video.id,
      reason: e instanceof Error ? e.message : "unknown",
    });
  }

  // 残りの取得が終わるまで待つ（after() は、ここで返す Promise が終わるまでサーバーの処理を続ける）。
  await fetching;
  // 動画が削除されていた場合は、更新する行がないだけで、エラーにはならない。
  const { error } = await admin
    .from("videos")
    .update({ analysis_status: status })
    .eq("id", video.id);
  if (error) console.error("[analyze-comments] analysis_status の更新に失敗しました", error.message);
}

/** 1まとまり（最大50件）を分析して保存する。 */
async function analyzeBatch(
  admin: AdminClient,
  comments: Comment[],
  ngWords: NgWord[],
  ai: AnalysisAi,
  ctx: UsageContext,
): Promise<void> {
  const matches = comments.map((c) => matchNgWords(c.comment_text, ngWords));
  // severity=5 にヒットしたコメントは、AI に送らない（要件定義書9.2）。
  const toAi = comments.flatMap((c, i) => (isHarmfulByNgWord(matches[i]) ? [] : [i]));

  const [classifications, moderations] =
    toAi.length === 0
      ? [[], []]
      : await Promise.all([
          ai.classify(
            toAi.map((i) => ({ text: comments[i].comment_text, ngHints: matches[i].words })),
            ctx,
          ),
          ai.moderate(
            toAi.map((i) => comments[i].comment_text),
            ctx,
          ),
        ]);
  const aiPosition = new Map(toAi.map((commentIndex, position) => [commentIndex, position]));

  const analyzedAt = new Date().toISOString();
  const rows = comments.map((comment, i) => {
    const position = aiPosition.get(i);
    const decision = decideAnalysis(
      matches[i],
      position === undefined ? null : classifications[position],
      position === undefined ? null : moderations[position],
    );
    return {
      comment_id: comment.id,
      is_latest: true,
      analyzed_at: analyzedAt,
      primary_category: decision.primaryCategory,
      labels: decision.labels,
      ng_words: decision.ngWords.length > 0 ? decision.ngWords : null,
      score: decision.score,
      review_required: decision.reviewRequired,
      // グループ（group_id）と embedding は、この後の groupPendingComments で書き込む。
    };
  });

  const { error } = await admin.from("comment_analysis").insert(rows);
  if (error) throw error;
}

async function loadNgWords(admin: AdminClient): Promise<NgWord[]> {
  const { data, error } = await admin.from("ng_words").select("word, normalized, severity");
  if (error) throw error;
  return data;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/**
 * 分析をやり直す（画面の「分析をやり直す」ボタン。要件定義書15.2）。
 * 分析が失敗した（または止まった）自分の動画だけが対象。まだ分析されていないコメントだけを分析する。
 *   - 返り値 "not_found"：他人の動画・期限切れ・存在しない
 *   - 返り値 "not_failed"：分析中・完了の動画（2重に分析を走らせないため）
 *   - それ以外：裏で実行する関数（API Route が after() に渡す）
 */
export async function retryAnalysis(
  owner: Owner,
  videoId: string,
  ai: AnalysisAi = openAiAnalysis,
  now: Date = new Date(),
): Promise<"not_found" | "not_failed" | (() => Promise<void>)> {
  const video = await findOwnedVideo(owner, videoId, now);
  if (!video) return "not_found";
  if ((await effectiveAnalysisStatus(video, now)) !== "failed") return "not_failed";

  // 「今の状態のままなら analyzing にする」という条件付きの更新にして、
  // ボタンが同時に2回押されても、分析を始めるのは1回だけにする（2回目は更新される行が0になる）。
  const { count, error } = await createAdminClient()
    .from("videos")
    .update(
      { analysis_status: "analyzing", analysis_started_at: now.toISOString() },
      { count: "exact" },
    )
    .eq("id", video.id)
    .eq("analysis_status", video.analysis_status)
    .eq("analysis_started_at", video.analysis_started_at);
  if (error) throw error;
  if (count !== 1) return "not_failed";

  return () => analyzeVideoComments(video, { ai });
}
