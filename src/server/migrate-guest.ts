import "server-only";

import { expiryCutoff } from "@/lib/config/retention";
import { clearGuestCookie, readGuestId } from "@/server/guest";
import { createAdminClient } from "@/server/supabase/admin";

// =============================================================
// ゲストからログインユーザーへのデータ引継ぎ（要件定義書3.1）
//
// 所有者を videos だけが持つ設計（要件定義書13.2）なので、videos の行を更新するだけで、
// コメント・分析結果・アドバイスもまとめてユーザーのものになる。
// created_at は変えない。保持期間の起点は元のままで、以後はユーザーの期間（29日）が適用される。
// =============================================================

/**
 * guestId の動画を userId のものにする。引継いだ動画の件数を返す。
 *
 * 期限切れのゲスト動画（作成から24時間超、まだ削除ジョブが動いていないもの）は引継がない。
 * 引継ぐとユーザーの期間（29日）が適用され、本来は消えているはずのデータが復活してしまうため。
 * 「期限切れは存在しないものとして扱う」（要件定義書3.3）の一部。
 */
export async function migrateGuestVideosToUser(
  guestId: string,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  // ゲストの行には RLS のポリシーがなく、ログインユーザーの権限では見えないので、service role で更新する。
  // user_id と guest_id を1回の UPDATE で同時に入れ替えるので、排他 CHECK 制約に途中で違反することはない。
  const { data, error } = await createAdminClient()
    .from("videos")
    .update({ user_id: userId, guest_id: null })
    .eq("guest_id", guestId)
    .gte("created_at", expiryCutoff("guest", now).toISOString())
    .select("id");
  if (error) throw error;
  return data.length;
}

/**
 * ログイン／サインアップが成立した直後に呼ぶ（src/app/auth/actions.ts）。
 * 有効な guest_id の Cookie があれば、確認画面なしで引継ぎ、Cookie を削除する。
 */
export async function takeOverGuestDataOnLogin(userId: string): Promise<void> {
  const guestId = await readGuestId();
  if (!guestId) return;

  await migrateGuestVideosToUser(guestId, userId);
  // 引継ぎに成功してから Cookie を消す。順番が逆だと、UPDATE が失敗したときにデータへ戻れなくなる。
  await clearGuestCookie();
}
