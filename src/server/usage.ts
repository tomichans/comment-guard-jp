import "server-only";

import type { TablesInsert } from "@/lib/database.types";
import { createAdminClient } from "@/server/supabase/admin";

// =============================================================
// API使用量の記録（要件定義書14.2、17.2）【確定】api_usage_logs テーブルに記録する
//
// 1回の API 呼び出しにつき1行。YouTube はクォータ消費量（units）を、
// AI（スライス3以降）はモデル名・トークン数・推定費用を記録する。
// 記録の失敗で、ユーザーの操作（動画の登録など）まで失敗させないよう、エラーはログに出すだけにする。
// =============================================================

/** 誰の操作による呼び出しか。ゲストのときだけ ipHash を持つ。 */
export type UsageContext = {
  videoId: string;
  userId: string | null;
  guestId: string | null;
  ipHash: string | null;
};

type UsageRecord = Omit<
  TablesInsert<"api_usage_logs">,
  "id" | "created_at" | "video_id" | "user_id" | "guest_id" | "ip_hash"
>;

export async function recordApiUsage(ctx: UsageContext, record: UsageRecord) {
  const { error } = await createAdminClient()
    .from("api_usage_logs")
    .insert({
      ...record,
      video_id: ctx.videoId,
      user_id: ctx.userId,
      guest_id: ctx.guestId,
      ip_hash: ctx.ipHash,
    });
  // API キーやコメント本文は含まれないので、エラー内容をそのまま出してよい。
  if (error) console.error("[api-usage] 記録に失敗しました", error.message);
}

/** YouTube API の1回の呼び出しで消費するクォータ（videos.list、commentThreads.list はどちらも1）。 */
const YOUTUBE_UNITS = 1;

/**
 * YouTube API を呼び、成功・失敗にかかわらず使用量を記録する。
 * 失敗した呼び出しもクォータを消費するので、記録する。
 */
export async function withYouTubeUsage<T>(
  ctx: UsageContext,
  endpoint: "videos.list" | "commentThreads.list",
  call: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  let succeeded = false;
  try {
    const result = await call();
    succeeded = true;
    return result;
  } finally {
    await recordApiUsage(ctx, {
      service: "youtube",
      endpoint,
      units: YOUTUBE_UNITS,
      succeeded,
      duration_ms: Date.now() - started,
    });
  }
}
