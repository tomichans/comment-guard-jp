import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  COMMENT_PAGE_SIZE,
  DEFAULT_COMMENT_SORT,
  type CommentSort,
} from "@/lib/comment-list";
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

export type CommentThread = Comment & {
  /** 保存されている返信（古い順）。YouTube が同梱した数件だけ（要件定義書7.3）。 */
  replies: Comment[];
};

export type CommentThreadPage = {
  threads: CommentThread[];
  /** 条件（検索語）に合うスレッドの総数 */
  total: number;
  /** 続きを読み込むときの offset。最後まで読み込んだら null。 */
  nextOffset: number | null;
};

export type CommentListOptions = {
  sort?: CommentSort;
  /** 親コメントの本文に含まれる語（部分一致）。空なら絞り込まない。 */
  q?: string;
  offset?: number;
};

// 並び順ごとの、DB の並べ替えの列（上から順に比べる）。
// 値のない行（NULL）は最後に回す。最後に id で並べるのは、同じ値の行の順番を毎回同じにして、
// 続きを読み込んだときに、同じコメントが2回出たり抜けたりしないようにするため。
const SORT_COLUMNS = {
  newest: ["posted_at"],
  likes: ["like_count", "posted_at"],
  replies: ["reply_count", "posted_at"],
} as const satisfies Record<CommentSort, readonly (keyof Comment)[]>;

/**
 * 自分の動画のコメント一覧を、スレッド（親コメント＋返信）の形で、COMMENT_PAGE_SIZE 件ずつ返す。
 * 動画が自分のものでなければ null。
 *
 * comments は所有者の列を持たない（所有者は videos だけが持つ。要件定義書13.2）。
 * そのため、必ず先に findOwnedVideo() で動画の所有を確認してから、その動画の id でコメントを読む。
 * 子テーブル（comment_analysis、comment_groups、advice_logs）を読む関数も、後のスライスで同じ形で追加する。
 *
 * 並べ替え・検索・件数の区切りは、親コメントに対して行う。返信は、そのページの親コメントの分だけ読む。
 */
export async function listCommentThreadsOfOwnedVideo(
  owner: Owner,
  videoId: string,
  { sort = DEFAULT_COMMENT_SORT, q = "", offset = 0 }: CommentListOptions = {},
  now: Date = new Date(),
): Promise<CommentThreadPage | null> {
  const video = await findOwnedVideo(owner, videoId, now);
  if (!video) return null;
  const client = clientFor(owner);

  // [Supabase固有] count: "exact" で、条件に合う行の総数も一緒に受け取る（「全123件」の表示用）。
  let query = client
    .from("comments")
    .select("*", { count: "exact" })
    .eq("video_id", video.id)
    .is("parent_comment_id", null);
  // TODO(未決定)：返信も検索の対象に含めるか（要件定義書4.3）。今は親コメントの本文だけを検索する。
  if (q) query = query.ilike("comment_text", `%${escapeLike(q)}%`);
  for (const column of SORT_COLUMNS[sort]) {
    query = query.order(column, { ascending: false, nullsFirst: false });
  }
  const { data: parents, error, count } = await query
    .order("id")
    .range(offset, offset + COMMENT_PAGE_SIZE - 1);
  if (error) throw error;

  const repliesByParent = new Map<string, Comment[]>();
  if (parents.length > 0) {
    const { data: replies, error: repliesError } = await client
      .from("comments")
      .select("*")
      .eq("video_id", video.id)
      .in(
        "parent_comment_id",
        parents.map((p) => p.id),
      )
      .order("posted_at", { ascending: true, nullsFirst: false })
      .order("id");
    if (repliesError) throw repliesError;
    for (const reply of replies) {
      const list = repliesByParent.get(reply.parent_comment_id!) ?? [];
      list.push(reply);
      repliesByParent.set(reply.parent_comment_id!, list);
    }
  }

  const total = count ?? 0;
  const next = offset + parents.length;
  return {
    threads: parents.map((p) => ({ ...p, replies: repliesByParent.get(p.id) ?? [] })),
    total,
    nextOffset: parents.length > 0 && next < total ? next : null,
  };
}

/**
 * LIKE の検索語に含まれる記号（%、_、\）を、ただの文字として扱うようにする。
 * [Supabase固有] PostgREST は * も「何にでも一致」として扱い、これは打ち消せない。
 * 「*」で検索すると全件が出るだけで害はないため、そのままにしている。
 */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
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
