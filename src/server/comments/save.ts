import "server-only";

import { createHash } from "node:crypto";

import type { AdminClient } from "@/server/supabase/admin";
import type { YouTubeComment } from "@/server/youtube/client";

// =============================================================
// 取得したコメントの保存（要件定義書7.3、7.4）
//
// 重複防止：同じ YouTube コメントID は1行だけ（DB の (video_id, external_comment_id) ユニーク制約でも保証）。
// 本文変更の検知：本文の SHA-256 を body_hash に保存し、次に同じコメントを取得したときに比べる。
//   - 新規コメント        → INSERT（分析対象）
//   - 本文が変わったもの  → UPDATE（updated_at が自動で更新され、再分析対象になる）
//   - 変わっていないもの  → 何もしない（いいね数などのメタデータの変化では、再分析しない）
//
// MVP では、コメントを取得するのは動画の登録時だけ（要件定義書7.4）。
// それでも上の仕組みが必要なのは、ページを順に取得している間に新しいコメントが付くと、
// 同じコメントが次のページにずれて、2回返ってくることがあるため。
// =============================================================

export function bodyHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export type SaveResult = { inserted: number; updated: number; unchanged: number };

/**
 * 1ページ分のコメント（親と返信）を保存する。
 * 親を先に保存して内部の id を確定させ、返信の parent_comment_id に使う
 * （YouTube の親コメントIDと、内部の parent_comment_id は別物。要件定義書13.2）。
 */
export async function saveComments(
  admin: AdminClient,
  videoId: string,
  comments: YouTubeComment[],
): Promise<SaveResult> {
  const parents = comments.filter((c) => c.parentExternalId === null);
  const replies = comments.filter((c) => c.parentExternalId !== null);

  const total: SaveResult = { inserted: 0, updated: 0, unchanged: 0 };
  const parentIds = await saveBatch(admin, videoId, parents, new Map(), total);
  await saveBatch(admin, videoId, replies, parentIds, total);
  return total;
}

/**
 * コメントの配列を保存し、「YouTube のID → 内部の id」の対応表を返す。
 * parentIds は、返信を保存するときに使う親コメントの対応表。
 */
async function saveBatch(
  admin: AdminClient,
  videoId: string,
  comments: YouTubeComment[],
  parentIds: Map<string, string>,
  total: SaveResult,
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  if (comments.length === 0) return idMap;

  // すでに保存されているコメントを、まとめて1回で読む。
  const { data: existing, error } = await admin
    .from("comments")
    .select("id, external_comment_id, body_hash")
    .eq("video_id", videoId)
    .in(
      "external_comment_id",
      comments.map((c) => c.externalId),
    );
  if (error) throw error;
  const existingByExternalId = new Map(existing.map((row) => [row.external_comment_id, row]));

  const toInsert = [];
  // 同じページの中に同じコメントが2回入っていても、1回だけ扱う。
  const seen = new Set<string>();
  for (const c of comments) {
    if (seen.has(c.externalId)) continue;
    seen.add(c.externalId);

    const hash = bodyHash(c.text);
    const parentId = c.parentExternalId ? (parentIds.get(c.parentExternalId) ?? null) : null;
    // 返信なのに親が見つからない場合（親の保存に失敗したなど）は、孤立した返信を作らずに飛ばす。
    if (c.parentExternalId && !parentId) continue;

    const row = existingByExternalId.get(c.externalId);
    if (!row) {
      toInsert.push({
        video_id: videoId,
        external_comment_id: c.externalId,
        comment_text: c.text,
        author: c.author,
        like_count: c.likeCount,
        body_hash: hash,
        parent_comment_id: parentId,
        posted_at: c.postedAt,
      });
      continue;
    }

    idMap.set(c.externalId, row.id);
    if (row.body_hash === hash) {
      total.unchanged += 1;
      continue;
    }
    const { error: updateError } = await admin
      .from("comments")
      .update({ comment_text: c.text, body_hash: hash, like_count: c.likeCount })
      .eq("id", row.id);
    if (updateError) throw updateError;
    total.updated += 1;
  }

  if (toInsert.length > 0) {
    const { data: inserted, error: insertError } = await admin
      .from("comments")
      .insert(toInsert)
      .select("id, external_comment_id");
    if (insertError) throw insertError;
    for (const row of inserted) idMap.set(row.external_comment_id!, row.id);
    total.inserted += inserted.length;
  }

  return idMap;
}
