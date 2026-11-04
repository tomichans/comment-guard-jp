import "server-only";

import { PRIMARY_CATEGORIES } from "@/lib/comment-categories";
import {
  ADVICE_MIN_ANALYZED_COMMENTS,
  ADVICE_SAMPLE_COMMENTS,
  ADVICE_SAMPLE_MAX_LENGTH,
  ADVICE_TOP_GROUPS,
} from "@/lib/config/analysis";
import type { Enums, Tables } from "@/lib/database.types";
import { serverEnv } from "@/server/env";
import type { AdminClient } from "@/server/supabase/admin";
import type { UsageContext } from "@/server/usage";

import type {
  AdviceCluster,
  AdviceCommentExample,
  AdviceInput,
  AdviceResult,
  AnalysisAi,
} from "./ai";

// =============================================================
// AIアドバイス（要件定義書12章。スライス5）
//
// いつ作るか【確定】：コメントの分析がすべて終わったとき（analyze.ts の最後）に、1動画につき1回だけ作る。
//   - 分析が済んだ親コメントが ADVICE_MIN_ANALYZED_COMMENTS 件より少なければ、作らない（画面に「コメントが少ないため…」と出す）
//   - すでにアドバイスがある動画では、作らない（再生成はMVPの対象外。要件定義書2.3）
//   - 作るのに失敗したら、分析と同じく analysis_status を failed にする。「分析をやり直す」で、アドバイスだけ作り直せる
//     （分析が済んでいないコメントがなければ、分析は何もせずに、ここまで進むため）
//
// AI に渡すのは、集計済みのデータだけ（要件定義書12.2）。全コメントは渡さない。
//   - 分類ごとの件数、ランキングの上位のグループ（論点・件数・いいねの合計）
//   - ポジティブと否定的意見のコメントを、いいねが多い順に少しだけ（何が評価されたか、どんな意見かは、件数だけでは分からないため）
//   - 要注意（harmful）とスパムの本文は渡さない（アドバイスに暴言が入らないようにするため）
// =============================================================

type Video = Pick<Tables<"videos">, "id" | "title">;

/**
 * 動画のアドバイスを作って、advice_logs に保存する。
 *   - "created"：作った
 *   - "exists"：すでにある（作らない）
 *   - "too_few"：分析が済んだコメントが少ない（作らない）
 */
export async function generateAdvice(
  admin: AdminClient,
  video: Video,
  ai: AnalysisAi,
  ctx: UsageContext,
): Promise<"created" | "exists" | "too_few"> {
  const { count, error } = await admin
    .from("advice_logs")
    .select("id", { count: "exact", head: true })
    .eq("video_id", video.id);
  if (error) throw error;
  if ((count ?? 0) > 0) return "exists";

  const input = await buildAdviceInput(admin, video);
  if (input.analyzed_comment_count < ADVICE_MIN_ANALYZED_COMMENTS) return "too_few";

  const result = await ai.advise(input, ctx);
  const now = new Date().toISOString();
  const { error: insertError } = await admin.from("advice_logs").insert({
    video_id: video.id,
    advice_summary: result.summary.trim(),
    advice_text: formatAdviceText(result),
    // MVPでは再生成がないので、常に system。user_id と guest_id は NULL（要件定義書12.4）。
    triggered_by: "system",
    model_version: serverEnv.openaiAdviceModel,
    generated_at: now,
  });
  if (insertError) throw insertError;
  return "created";
}

/** アドバイスの AI に渡すデータを集める（要件定義書12.2）。 */
export async function buildAdviceInput(admin: AdminClient, video: Video): Promise<AdviceInput> {
  const [summary, rankings, praise, negative] = await Promise.all([
    admin.rpc("video_analysis_summary", { p_video_id: video.id }),
    admin.rpc("video_rankings", { p_video_id: video.id, p_limit: ADVICE_TOP_GROUPS }),
    commentExamples(admin, video.id, "praise"),
    commentExamples(admin, video.id, "negative_opinion"),
  ]);
  if (summary.error) throw summary.error;
  if (rankings.error) throw rankings.error;

  const counts = (summary.data as { counts: Partial<Record<Enums<"primary_category">, number>> }).counts;
  // 7種すべてを入れる（0 の分類も入れる。要件定義書12.2）。
  const categoryCounts = Object.fromEntries(
    PRIMARY_CATEGORIES.map((c) => [c, counts[c] ?? 0]),
  ) as AdviceInput["category_counts"];

  type Item = { id: string; text: string; count: number };
  const groups = rankings.data as { feedback_request: Item[]; question: Item[] };
  const likes = await likesOfGroups(admin, [...groups.feedback_request, ...groups.question].map((g) => g.id));
  const toCluster = (g: Item): AdviceCluster => ({
    topic: g.text,
    comment_count: g.count,
    total_likes: likes.get(g.id) ?? 0,
  });

  return {
    video_title: video.title,
    analyzed_comment_count: Object.values(categoryCounts).reduce((sum, n) => sum + n, 0),
    category_counts: categoryCounts,
    top_feedback_clusters: groups.feedback_request.map(toCluster),
    top_question_clusters: groups.question.map(toCluster),
    praise_examples: praise,
    negative_opinion_examples: negative,
  };
}

/** 分類が category の親コメントを、いいねが多い順に ADVICE_SAMPLE_COMMENTS 件。本文は長さを切る。 */
async function commentExamples(
  admin: AdminClient,
  videoId: string,
  category: "praise" | "negative_opinion",
): Promise<AdviceCommentExample[]> {
  const { data, error } = await admin
    .from("comments")
    .select("comment_text, like_count, comment_analysis!inner(primary_category)")
    .eq("video_id", videoId)
    .is("parent_comment_id", null)
    .eq("comment_analysis.is_latest", true)
    .eq("comment_analysis.primary_category", category)
    .order("like_count", { ascending: false, nullsFirst: false })
    .order("id")
    .limit(ADVICE_SAMPLE_COMMENTS);
  if (error) throw error;
  return data.map((c) => ({
    text: c.comment_text.slice(0, ADVICE_SAMPLE_MAX_LENGTH),
    likes: c.like_count ?? 0,
  }));
}

/** グループごとの、いいねの合計（最新の分析結果の論点が入っている親コメントの like_count の合計）。 */
async function likesOfGroups(admin: AdminClient, groupIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (groupIds.length === 0) return totals;
  const { data, error } = await admin
    .from("comment_topics")
    .select("group_id, comment_analysis!inner(is_latest, comments!inner(like_count))")
    .in("group_id", groupIds)
    .eq("comment_analysis.is_latest", true);
  if (error) throw error;
  for (const row of data) {
    const likes = row.comment_analysis.comments.like_count ?? 0;
    totals.set(row.group_id!, (totals.get(row.group_id!) ?? 0) + likes);
  }
  return totals;
}

/** アドバイスの見出し。保存する文章（advice_text）の、各まとまりの最初の行になる。 */
export const ADVICE_HEADINGS = {
  goodPoints: "評価された点",
  improvements: "多かった要望・指摘・質問から",
  gentleSuggestions: "否定的な意見から",
  nextVideoIdeas: "次の動画のアイデア",
} as const;

/**
 * AI の出力を、保存する文章（advice_text）にする。項目が空のまとまりは書かない。
 * 例：
 *   ■ 評価された点
 *   ・手順が分かりやすいという声が多くありました。
 *
 *   ■ 多かった要望・指摘・質問から
 *   ・…
 * 画面では、この文章を HTML としてではなく、文字としてそのまま表示する（要件定義書16章）。
 */
export function formatAdviceText(result: AdviceResult): string {
  return (Object.keys(ADVICE_HEADINGS) as (keyof typeof ADVICE_HEADINGS)[])
    .map((key) => {
      const items = result[key].map((item) => item.trim()).filter(Boolean);
      if (items.length === 0) return null;
      return [`■ ${ADVICE_HEADINGS[key]}`, ...items.map((item) => `・${item}`)].join("\n");
    })
    .filter((section): section is string => section !== null)
    .join("\n\n");
}
