import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMMENT_PAGE_SIZE } from "@/lib/comment-list";
import { listCommentThreadsOfOwnedVideo, type Owner } from "@/server/access";

import { admin, cleanup, insertVideo, newGuestId } from "./helpers/db";

// コメント一覧（要件定義書4.3、17.1）：並び順、検索、続きの読み込み、返信のまとめ方
describe("コメント一覧（スレッドの形）", () => {
  let owner: Owner;
  let videoId: string;

  /** 親コメントを1つ作る */
  async function insertParent(opts: {
    text: string;
    likes: number | null;
    replies: number | null;
    postedAt: string | null;
  }): Promise<string> {
    const { data, error } = await admin
      .from("comments")
      .insert({
        video_id: videoId,
        external_comment_id: `c-${crypto.randomUUID()}`,
        comment_text: opts.text,
        like_count: opts.likes,
        reply_count: opts.replies,
        posted_at: opts.postedAt,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  beforeAll(async () => {
    const guestId = newGuestId();
    owner = { kind: "guest", guestId };
    videoId = (await insertVideo({ guestId })).id;

    const a = await insertParent({ text: "BGMが大きい", likes: 5, replies: 0, postedAt: "2026-10-03T00:00:00Z" });
    await insertParent({ text: "最高でした", likes: 50, replies: 2, postedAt: "2026-10-01T00:00:00Z" });
    await insertParent({ text: "100%同意", likes: null, replies: 30, postedAt: "2026-10-02T00:00:00Z" });
    await insertParent({ text: "投稿日時なし", likes: 1, replies: null, postedAt: null });

    // 返信は親コメント a に付ける（古い順で返ること）
    const { error } = await admin.from("comments").insert([
      { video_id: videoId, external_comment_id: "r2", comment_text: "返信2", parent_comment_id: a, posted_at: "2026-10-05T00:00:00Z" },
      { video_id: videoId, external_comment_id: "r1", comment_text: "返信1", parent_comment_id: a, posted_at: "2026-10-04T00:00:00Z" },
    ]);
    if (error) throw error;
  });

  afterAll(cleanup);

  async function texts(sort?: "newest" | "likes" | "replies", q?: string) {
    const page = await listCommentThreadsOfOwnedVideo(owner, videoId, { sort, q });
    return page!.threads.map((t) => t.comment_text);
  }

  it("既定は新しい順。投稿日時のないものは最後", async () => {
    expect(await texts()).toEqual(["BGMが大きい", "100%同意", "最高でした", "投稿日時なし"]);
  });

  it("いいねが多い順。いいね数のないものは最後", async () => {
    expect(await texts("likes")).toEqual(["最高でした", "BGMが大きい", "投稿日時なし", "100%同意"]);
  });

  it("返信が多い順（YouTube の返信の総数 reply_count で並べる）", async () => {
    expect(await texts("replies")).toEqual(["100%同意", "最高でした", "BGMが大きい", "投稿日時なし"]);
  });

  it("返信は一覧の行にならず、親コメントの replies に古い順で入る", async () => {
    const page = await listCommentThreadsOfOwnedVideo(owner, videoId);
    expect(page!.total).toBe(4);
    const bgm = page!.threads.find((t) => t.comment_text === "BGMが大きい")!;
    expect(bgm.replies.map((r) => r.comment_text)).toEqual(["返信1", "返信2"]);
  });

  it("検索は親コメントの本文の部分一致。% はただの文字として扱う", async () => {
    expect(await texts(undefined, "BGM")).toEqual(["BGMが大きい"]);
    expect(await texts(undefined, "%")).toEqual(["100%同意"]);
    expect(await texts(undefined, "返信")).toEqual([]);
  });

  it(`${COMMENT_PAGE_SIZE}件ずつ返し、nextOffset で続きを読める。最後は null`, async () => {
    const guestId = newGuestId();
    const many: Owner = { kind: "guest", guestId };
    const video = await insertVideo({ guestId });
    const count = COMMENT_PAGE_SIZE + 3;
    const { error } = await admin.from("comments").insert(
      Array.from({ length: count }, (_, i) => ({
        video_id: video.id,
        external_comment_id: `m-${i}`,
        comment_text: `コメント${i}`,
        // 同じ投稿日時でも、ページの境目で重複・抜けが出ないこと（id で順番が決まる）
        posted_at: "2026-10-01T00:00:00Z",
      })),
    );
    if (error) throw error;

    const first = await listCommentThreadsOfOwnedVideo(many, video.id);
    expect(first!.threads).toHaveLength(COMMENT_PAGE_SIZE);
    expect(first!.total).toBe(count);
    expect(first!.nextOffset).toBe(COMMENT_PAGE_SIZE);

    const second = await listCommentThreadsOfOwnedVideo(many, video.id, { offset: first!.nextOffset! });
    expect(second!.threads).toHaveLength(3);
    expect(second!.nextOffset).toBeNull();

    const ids = [...first!.threads, ...second!.threads].map((t) => t.id);
    expect(new Set(ids).size).toBe(count);
  });

  it("他のゲストの動画のコメントは読めない", async () => {
    const other: Owner = { kind: "guest", guestId: newGuestId() };
    expect(await listCommentThreadsOfOwnedVideo(other, videoId)).toBeNull();
  });
});
