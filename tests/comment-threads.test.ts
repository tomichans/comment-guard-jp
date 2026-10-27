import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMMENT_PAGE_SIZE } from "@/lib/comment-list";
import { listCommentThreadsOfOwnedVideo, type Owner } from "@/server/access";

import { admin, cleanup, insertVideo, newGuestId } from "./helpers/db";

// =============================================================
// コメント一覧（要件定義書4.3、17.1）：並び順、検索、返信のまとめ方、続きの読み込み
//
// このファイルのコメントには分析結果を付けない。そのため、動画は「分析に失敗した（failed）」状態で作る。
// failed の動画では、「すべて」タブ（既定のタブ）に分析されていないコメントも出る（要件定義書15.2）。
// analyzing のままだと、分析されていないコメントは1件も出ないので注意。
// =============================================================

/** ゲストの動画を1本作る（分析結果なしでも「すべて」タブに出るよう、failed にする）。 */
async function createGuestVideo() {
  const guestId = newGuestId();
  const owner: Owner = { kind: "guest", guestId };
  const video = await insertVideo({ guestId, analysisStatus: "failed" });
  return { owner, videoId: video.id };
}

describe("並び順・検索・返信", () => {
  let owner: Owner;
  let videoId: string;

  /** 親コメントを1つ作り、その id を返す。null は「YouTube から値が来なかった」ことを表す。 */
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

  // 準備：このグループのテストすべてで使う親コメント4件と、返信2件
  //
  //   本文          いいね  返信の総数  投稿日時
  //   BGMが大きい      5        0       10/3   ← 返信2件を付ける
  //   最高でした      50        2       10/1
  //   100%同意      なし       30       10/2
  //   投稿日時なし     1      なし      なし
  beforeAll(async () => {
    ({ owner, videoId } = await createGuestVideo());

    const bgm = await insertParent({ text: "BGMが大きい", likes: 5, replies: 0, postedAt: "2026-10-03T00:00:00Z" });
    await insertParent({ text: "最高でした", likes: 50, replies: 2, postedAt: "2026-10-01T00:00:00Z" });
    await insertParent({ text: "100%同意", likes: null, replies: 30, postedAt: "2026-10-02T00:00:00Z" });
    await insertParent({ text: "投稿日時なし", likes: 1, replies: null, postedAt: null });

    // 返信は、わざと新しい方から入れる（一覧では古い順に並び替えて返ること）
    const { error } = await admin.from("comments").insert([
      { video_id: videoId, external_comment_id: "r2", comment_text: "返信2", parent_comment_id: bgm, posted_at: "2026-10-05T00:00:00Z" },
      { video_id: videoId, external_comment_id: "r1", comment_text: "返信1", parent_comment_id: bgm, posted_at: "2026-10-04T00:00:00Z" },
    ]);
    if (error) throw error;
  });

  afterAll(cleanup);

  /** 一覧を取得し、親コメントの本文だけを、並んでいる順に返す。 */
  async function listTexts(opts: { sort?: "newest" | "likes" | "replies"; q?: string } = {}) {
    const result = await listCommentThreadsOfOwnedVideo(owner, videoId, opts);
    return result?.threads.map((t) => t.comment_text);
  }

  it("既定は新しい順。投稿日時のないものは最後", async () => {
    expect(await listTexts()).toEqual(["BGMが大きい", "100%同意", "最高でした", "投稿日時なし"]);
  });

  it("いいねが多い順。いいね数のないものは最後", async () => {
    expect(await listTexts({ sort: "likes" })).toEqual(["最高でした", "BGMが大きい", "投稿日時なし", "100%同意"]);
  });

  it("返信が多い順（YouTube の返信の総数 reply_count で並べる）", async () => {
    expect(await listTexts({ sort: "replies" })).toEqual(["100%同意", "最高でした", "BGMが大きい", "投稿日時なし"]);
  });

  it("返信は一覧の行にならず、親コメントの replies に古い順で入る", async () => {
    const result = await listCommentThreadsOfOwnedVideo(owner, videoId);

    expect(result?.total).toBe(4); // 親コメントの数（返信は数えない）
    const bgm = result?.threads.find((t) => t.comment_text === "BGMが大きい");
    expect(bgm?.replies.map((r) => r.comment_text)).toEqual(["返信1", "返信2"]);
  });

  it("検索は親コメントの本文の部分一致。% はただの文字として扱う。返信は検索しない", async () => {
    expect(await listTexts({ q: "BGM" })).toEqual(["BGMが大きい"]);
    // SQL の LIKE では % は「何でも一致」の記号だが、ここでは文字の % として探す
    expect(await listTexts({ q: "%" })).toEqual(["100%同意"]);
    expect(await listTexts({ q: "返信" })).toEqual([]);
  });

  it("他のゲストの動画のコメントは読めない", async () => {
    const otherGuest: Owner = { kind: "guest", guestId: newGuestId() };
    expect(await listCommentThreadsOfOwnedVideo(otherGuest, videoId)).toBeNull();
  });
});

describe("続きの読み込み（要件定義書17.1）", () => {
  afterAll(cleanup);

  it(`${COMMENT_PAGE_SIZE}件ずつ返し、nextOffset で続きを読める。最後は null`, async () => {
    // 準備：1ページ分 + 3件 のコメント。投稿日時はすべて同じにする
    // （同じ日時でも、ページの境目で重複・抜けが出ないことを確かめるため。順番は id で決まる）
    const { owner, videoId } = await createGuestVideo();
    const count = COMMENT_PAGE_SIZE + 3;
    const { error } = await admin.from("comments").insert(
      Array.from({ length: count }, (_, i) => ({
        video_id: videoId,
        external_comment_id: `m-${i}`,
        comment_text: `コメント${i}`,
        posted_at: "2026-10-01T00:00:00Z",
      })),
    );
    if (error) throw error;

    // 1ページ目
    const first = await listCommentThreadsOfOwnedVideo(owner, videoId);
    expect(first?.threads).toHaveLength(COMMENT_PAGE_SIZE);
    expect(first?.total).toBe(count);
    expect(first?.nextOffset).toBe(COMMENT_PAGE_SIZE);

    // 2ページ目（最後）
    const second = await listCommentThreadsOfOwnedVideo(owner, videoId, { offset: COMMENT_PAGE_SIZE });
    expect(second?.threads).toHaveLength(3);
    expect(second?.nextOffset).toBeNull();

    // 2ページ合わせて、すべてのコメントがちょうど1回ずつ出た
    const ids = [...(first?.threads ?? []), ...(second?.threads ?? [])].map((t) => t.id);
    expect(new Set(ids).size).toBe(count);
  });
});
