import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { expiryCutoff, isExpired } from "@/lib/config/retention";
import type { Database, Tables } from "@/lib/database.types";
import { isUuid } from "@/lib/uuid";
import { createAdminClient } from "@/server/supabase/admin";

// =============================================================
// アクセス制御の共通関数（このファイルだけが「誰のデータを見せるか」を決める）
//
// API Route は、動画やその子データ（コメントなど）を読むとき、必ずこのファイルの関数を通す。
// 所有確認を各 API Route に書くと、1か所でも書き忘れれば他人のデータが漏れる。
// 1か所にまとめておけば、確認すべき場所もテストすべき場所も、ここだけになる。
//
// 判定する内容
//   1. 所有者が一致するか（ログインユーザーなら user_id、ゲストなら guest_id）
//   2. 保持期間内か（要件定義書3.3。削除ジョブが動く前でも、期限切れは見せない）
// どちらかを満たさなければ、「存在しない」と同じ扱い（null）にする。
// 「他人の動画です」と区別して返すと、その ID の動画が存在することを相手に教えてしまうため。
// =============================================================

export type Video = Tables<"videos">;
export type Comment = Tables<"comments">;

/**
 * リクエストの持ち主。src/server/owner.ts の getRequestOwner() で作る。
 *
 * ログインユーザーは、そのユーザーとしてログインした Supabase クライアントを持つ。
 * このクライアントは RLS が効くので、ここでの絞り込みを書き忘れても DB が他人の行を返さない（二重の防御）。
 * ゲストには RLS のポリシーがないため、service role クライアントで読み、guest_id の絞り込みが唯一の防御になる。
 */
export type Owner =
  | { kind: "user"; userId: string; client: SupabaseClient<Database> }
  | { kind: "guest"; guestId: string };

function clientFor(owner: Owner): SupabaseClient<Database> {
  return owner.kind === "user" ? owner.client : createAdminClient();
}

/** 自分の動画を1件取得する。他人の動画・期限切れ・存在しない場合は null。 */
export async function findOwnedVideo(
  owner: Owner,
  videoId: string,
  now: Date = new Date(),
): Promise<Video | null> {
  if (!isUuid(videoId)) return null;

  let query = clientFor(owner).from("videos").select("*").eq("id", videoId);
  query =
    owner.kind === "user"
      ? query.eq("user_id", owner.userId)
      : query.eq("guest_id", owner.guestId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || isExpired(data, now)) return null;
  return data;
}

/** 自分の動画の一覧（期限内のものだけ、新しい順）。 */
export async function listOwnedVideos(
  owner: Owner,
  now: Date = new Date(),
): Promise<Video[]> {
  let query = clientFor(owner).from("videos").select("*");
  query =
    owner.kind === "user"
      ? query.eq("user_id", owner.userId)
      : query.eq("guest_id", owner.guestId);

  // 期限切れの判定は isExpired() と同じ境界（expiryCutoff）を DB 側の条件にしたもの。
  const cutoff = expiryCutoff(owner.kind, now).toISOString();
  const { data, error } = await query
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * 自分の動画のコメント一覧。動画が自分のものでなければ null。
 *
 * comments は所有者の列を持たない（所有者は videos だけが持つ。要件定義書13.2）。
 * そのため、必ず先に findOwnedVideo() で動画の所有を確認してから、その動画の id でコメントを読む。
 * 子テーブル（comment_analysis、comment_groups、advice_logs）を読む関数も、後のスライスで同じ形で追加する。
 */
export async function listCommentsOfOwnedVideo(
  owner: Owner,
  videoId: string,
  now: Date = new Date(),
): Promise<Comment[] | null> {
  const video = await findOwnedVideo(owner, videoId, now);
  if (!video) return null;

  const { data, error } = await clientFor(owner)
    .from("comments")
    .select("*")
    .eq("video_id", video.id)
    .order("posted_at", { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * 自分の動画を削除する（要件定義書18.2）。削除できたら true、他人の動画・期限切れ・存在しない場合は false。
 *
 * 削除できるのはログインユーザーだけなので、引数もログインユーザーに限っている（ゲストは API Route で 403 にする）。
 * 削除はログインユーザーの Supabase クライアントで行うので、RLS の videos_delete_own も効く（二重の防御）。
 * 消すのは videos の行だけ。コメント、分析結果、グループ、アドバイスは ON DELETE CASCADE で DB が連鎖して削除する（13.4）。
 */
export async function deleteOwnedVideo(
  owner: Extract<Owner, { kind: "user" }>,
  videoId: string,
  now: Date = new Date(),
): Promise<boolean> {
  // 期限切れの動画は「存在しない」扱い（3.3）なので、先に findOwnedVideo() で確認する。
  const video = await findOwnedVideo(owner, videoId, now);
  if (!video) return false;

  // count: "exact" で、実際に消えた行数を受け取る。
  // 確認と削除の間に削除ジョブなどで消えていた場合は 0 になり、「存在しない」として扱う。
  const { count, error } = await owner.client
    .from("videos")
    .delete({ count: "exact" })
    .eq("id", video.id)
    .eq("user_id", owner.userId);
  if (error) throw error;
  return count === 1;
}
