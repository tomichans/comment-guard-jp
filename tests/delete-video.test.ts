import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteOwnedVideo, type Owner } from "@/server/access";

import {
  ago,
  cleanup,
  createTestUser,
  DAY_MS,
  exists,
  insertChildren,
  insertVideo,
  newGuestId,
  type TestUser,
} from "./helpers/db";

// =============================================================
// ログインユーザーによる動画の削除（要件定義書18.2）
// 削除の可否は access.ts の deleteOwnedVideo() だけが決めるので、ここを確かめる。
// （ゲストが 403 になるのは API Route 側の分岐。ローカル確認の手順で確かめる）
// =============================================================

type UserOwner = Extract<Owner, { kind: "user" }>;

function ownerOf(u: TestUser): UserOwner {
  return { kind: "user", userId: u.userId, client: u.client };
}

describe("動画の削除", () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
  });

  afterAll(cleanup);

  it("自分の動画を削除すると、子テーブルのデータも連鎖して消える", async () => {
    const video = await insertVideo({ userId: userA.userId });
    const children = await insertChildren(video.id);

    expect(await deleteOwnedVideo(ownerOf(userA), video.id)).toBe(true);

    expect(await exists("videos", video.id)).toBe(false);
    expect(await exists("comments", children.commentId)).toBe(false);
    expect(await exists("comment_analysis", children.analysisId)).toBe(false);
    expect(await exists("comment_topics", children.topicId)).toBe(false);
    expect(await exists("comment_groups", children.groupId)).toBe(false);
    expect(await exists("advice_logs", children.adviceId)).toBe(false);
  });

  it("他のユーザーの動画は削除できない", async () => {
    const video = await insertVideo({ userId: userB.userId });

    expect(await deleteOwnedVideo(ownerOf(userA), video.id)).toBe(false);
    expect(await exists("videos", video.id)).toBe(true);
  });

  it("ゲストの動画は削除できない", async () => {
    const video = await insertVideo({ guestId: newGuestId() });

    expect(await deleteOwnedVideo(ownerOf(userA), video.id)).toBe(false);
    expect(await exists("videos", video.id)).toBe(true);
  });

  it("期限切れの自分の動画は「存在しない」扱いで、false を返す", async () => {
    const video = await insertVideo({ userId: userA.userId, createdAt: ago(30 * DAY_MS) });

    expect(await deleteOwnedVideo(ownerOf(userA), video.id)).toBe(false);
  });

  it("存在しない ID や、uuid の形でない ID は false", async () => {
    expect(await deleteOwnedVideo(ownerOf(userA), crypto.randomUUID())).toBe(false);
    expect(await deleteOwnedVideo(ownerOf(userA), "not-a-uuid")).toBe(false);
  });

  it("同じ動画を2回削除すると、2回目は false", async () => {
    const video = await insertVideo({ userId: userA.userId });

    expect(await deleteOwnedVideo(ownerOf(userA), video.id)).toBe(true);
    expect(await deleteOwnedVideo(ownerOf(userA), video.id)).toBe(false);
  });
});
