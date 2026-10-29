import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  findOwnedVideo,
  listCommentThreadsOfOwnedVideo,
  listOwnedVideos,
  type Owner,
} from "@/server/access";

import {
  anonClient,
  cleanup,
  createTestUser,
  insertChildren,
  insertVideo,
  newGuestId,
} from "./helpers/db";

// ゲストのデータには RLS のポリシーがないので、access.ts の絞り込みだけが防御になる。
// そこが正しく効いていることを確かめる。
describe("ゲストのアクセス制御", () => {
  let guestA: Owner;
  let guestB: Owner;
  let videoA: string;
  let videoB: string;

  beforeAll(async () => {
    const idA = newGuestId();
    const idB = newGuestId();
    guestA = { kind: "guest", guestId: idA };
    guestB = { kind: "guest", guestId: idB };
    videoA = (await insertVideo({ guestId: idA })).id;
    videoB = (await insertVideo({ guestId: idB })).id;
    await insertChildren(videoA);
    await insertChildren(videoB);
  });

  afterAll(cleanup);

  it("ゲストAは自分の動画とコメントを読める", async () => {
    expect((await findOwnedVideo(guestA, videoA))?.id).toBe(videoA);
    expect((await listCommentThreadsOfOwnedVideo(guestA, videoA))?.threads).toHaveLength(1);
  });

  it("ゲストAはゲストBの動画を読めない", async () => {
    expect(await findOwnedVideo(guestA, videoB)).toBeNull();
  });

  it("ゲストAはゲストBのコメントを読めない", async () => {
    expect(await listCommentThreadsOfOwnedVideo(guestA, videoB)).toBeNull();
  });

  it("動画一覧には自分の動画だけが出る", async () => {
    const ids = (await listOwnedVideos(guestA)).map((v) => v.id);
    expect(ids).toEqual([videoA]);
    expect((await listOwnedVideos(guestB)).map((v) => v.id)).toEqual([videoB]);
  });

  it("ログインユーザーもゲストの動画を読めない", async () => {
    const user = await createTestUser();
    const owner: Owner = { kind: "user", userId: user.userId, client: user.client };
    expect(await findOwnedVideo(owner, videoA)).toBeNull();
    expect(await listCommentThreadsOfOwnedVideo(owner, videoA)).toBeNull();
  });

  it("UUID でない ID はエラーではなく「見つからない」になる", async () => {
    expect(await findOwnedVideo(guestA, "not-a-uuid")).toBeNull();
  });

  // [Supabase固有] ブラウザに公開される anon キーで REST API を直接叩かれても、
  // ゲストのデータは RLS（ポリシーなし）によって1行も見えないことを確かめる。
  it("anon キーで直接読んでも、ゲストのデータは見えない", async () => {
    const anon = anonClient();
    for (const table of [
      "videos",
      "comments",
      "comment_analysis",
      "comment_topics",
      "comment_groups",
      "advice_logs",
      "ng_words",
      "sources",
    ] as const) {
      const { data, error } = await anon.from(table).select("id");
      expect(error).toBeNull();
      expect(data, table).toEqual([]);
    }
  });
});
