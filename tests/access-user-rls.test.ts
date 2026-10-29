import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOwnedVideo, listCommentThreadsOfOwnedVideo, type Owner } from "@/server/access";

import {
  admin,
  cleanup,
  createTestUser,
  exists,
  insertChildren,
  insertVideo,
  type TestUser,
} from "./helpers/db";

// [Supabase固有] RLS のテスト。
// ユーザーとしてログインしたクライアントで、アプリの絞り込み（access.ts）を通さずに直接テーブルを読み、
// DB の RLS だけで他人の行が見えないことを確かめる。
describe("ログインユーザーのアクセス制御（RLS）", () => {
  let userA: TestUser;
  let userB: TestUser;
  let videoA: string;
  let videoB: string;
  let childrenA: Awaited<ReturnType<typeof insertChildren>>;
  let childrenB: Awaited<ReturnType<typeof insertChildren>>;

  beforeAll(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    videoA = (await insertVideo({ userId: userA.userId })).id;
    videoB = (await insertVideo({ userId: userB.userId })).id;
    childrenA = await insertChildren(videoA);
    childrenB = await insertChildren(videoB);
  });

  afterAll(cleanup);

  it("RLS：ユーザーAには、videos と子テーブルの自分の行だけが見える", async () => {
    const c = userA.client;
    const ids = async (
      table: "videos" | "comments" | "comment_analysis" | "comment_topics" | "comment_groups" | "advice_logs",
    ) => {
      const { data, error } = await c.from(table).select("id");
      expect(error).toBeNull();
      return data!.map((r) => r.id);
    };

    expect(await ids("videos")).toEqual([videoA]);
    expect(await ids("comments")).toEqual([childrenA.commentId]);
    expect(await ids("comment_analysis")).toEqual([childrenA.analysisId]);
    expect(await ids("comment_topics")).toEqual([childrenA.topicId]);
    expect(await ids("comment_groups")).toEqual([childrenA.groupId]);
    expect(await ids("advice_logs")).toEqual([childrenA.adviceId]);
  });

  it("RLS：ユーザーBの行を ID 指定で読もうとしても見えない", async () => {
    const c = userA.client;
    expect((await c.from("videos").select("id").eq("id", videoB)).data).toEqual([]);
    expect(
      (await c.from("comments").select("id").eq("id", childrenB.commentId)).data,
    ).toEqual([]);
  });

  it("RLS：users は自分の行だけが見える", async () => {
    const { data } = await userA.client.from("users").select("id, role");
    expect(data).toEqual([{ id: userA.userId, role: "user" }]);
  });

  it("RLS：ユーザーBの動画は削除できない（自分の動画は削除できる）", async () => {
    await userA.client.from("videos").delete().eq("id", videoB);
    expect(await exists("videos", videoB)).toBe(true);

    const own = await insertVideo({ userId: userA.userId });
    await userA.client.from("videos").delete().eq("id", own.id);
    expect(await exists("videos", own.id)).toBe(false);
  });

  it("RLS：書き込みのポリシーはないので、ユーザーが直接 INSERT / UPDATE できない", async () => {
    const source = await admin.from("sources").select("id").eq("name", "youtube").single();
    const insert = await userA.client.from("videos").insert({
      user_id: userA.userId,
      source_id: source.data!.id,
      video_id: "x",
      title: "直接INSERT",
    });
    expect(insert.error).not.toBeNull();

    // 自分の role を admin に書き換えようとしても、更新されない。
    await userA.client.from("users").update({ role: "admin" }).eq("id", userA.userId);
    const role = await admin.from("users").select("role").eq("id", userA.userId).single();
    expect(role.data!.role).toBe("user");
  });

  it("access.ts 経由でも、ユーザーAはユーザーBの動画とコメントを読めない", async () => {
    const owner: Owner = { kind: "user", userId: userA.userId, client: userA.client };
    expect((await findOwnedVideo(owner, videoA))?.id).toBe(videoA);
    expect(await findOwnedVideo(owner, videoB)).toBeNull();
    expect(await listCommentThreadsOfOwnedVideo(owner, videoB)).toBeNull();
  });
});
