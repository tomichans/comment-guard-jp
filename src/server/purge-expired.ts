import "server-only";

import { USAGE_LOG_RETENTION_DAYS, expiryCutoff } from "@/lib/config/retention";
import { createAdminClient } from "@/server/supabase/admin";

// =============================================================
// 期限切れ削除ジョブの本体（要件定義書3.3）
//
// 1時間ごとに /api/cron/purge-expired から呼ばれる（呼び出し元のスケジュールはデプロイのときに設定）。
// 同じジョブで、保持期間（90日）を過ぎた API使用量の記録（api_usage_logs）も消す（要件定義書17.2）。
// 消すのは videos の行だけ。comments、comment_analysis、comment_groups、advice_logs は
// 外部キーの ON DELETE CASCADE で DB が連鎖して削除する（要件定義書13.4）。
// アプリ側で子テーブルを順番に消す必要がなく、消し漏れも起きない。
// =============================================================

export type PurgeResult = { guestVideos: number; userVideos: number; usageLogs: number };

export async function purgeExpiredVideos(
  now: Date = new Date(),
): Promise<PurgeResult> {
  const admin = createAdminClient();

  // ゲストとログインユーザーで保持期間が違うので、2回に分けて削除する。
  // 条件の created_at < 境界時刻 は、isExpired()（読み取り時の判定）と同じ境界。
  // count: "exact" で、削除した行を返してもらわずに件数だけを受け取る。
  const guest = await admin
    .from("videos")
    .delete({ count: "exact" })
    .not("guest_id", "is", null)
    .lt("created_at", expiryCutoff("guest", now).toISOString());
  if (guest.error) throw guest.error;

  const user = await admin
    .from("videos")
    .delete({ count: "exact" })
    .not("user_id", "is", null)
    .lt("created_at", expiryCutoff("user", now).toISOString());
  if (user.error) throw user.error;

  // api_usage_logs は videos と外部キーでつながっていない（動画を消しても残す）ので、別に消す。
  const usageCutoff = new Date(now.getTime() - USAGE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const usage = await admin
    .from("api_usage_logs")
    .delete({ count: "exact" })
    .lt("created_at", usageCutoff.toISOString());
  if (usage.error) throw usage.error;

  return {
    guestVideos: guest.count ?? 0,
    userVideos: user.count ?? 0,
    usageLogs: usage.count ?? 0,
  };
}
