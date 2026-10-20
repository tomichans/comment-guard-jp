import "server-only";

import { expiryCutoff } from "@/lib/config/retention";
import { createAdminClient } from "@/server/supabase/admin";

// =============================================================
// 期限切れ削除ジョブの本体（要件定義書3.3）
//
// 1時間ごとに /api/cron/purge-expired から呼ばれる（呼び出し元のスケジュールはスライス6で設定）。
// 消すのは videos の行だけ。comments、comment_analysis、comment_groups、advice_logs は
// 外部キーの ON DELETE CASCADE で DB が連鎖して削除する（要件定義書13.4）。
// アプリ側で子テーブルを順番に消す必要がなく、消し漏れも起きない。
// =============================================================

export type PurgeResult = { guestVideos: number; userVideos: number };

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

  return { guestVideos: guest.count ?? 0, userVideos: user.count ?? 0 };
}
