import { afterAll, describe, expect, it } from "vitest";

import { findOwnedVideo, listCommentThreadsOfOwnedVideo, type Owner } from "@/server/access";
import { migrateGuestVideosToUser } from "@/server/migrate-guest";

import {
  HOUR_MS,
  admin,
  ago,
  cleanup,
  createTestUser,
  insertChildren,
  insertVideo,
  newGuestId,
} from "./helpers/db";

describe("ゲストからログインユーザーへの引継ぎ", () => {
  afterAll(cleanup);

  it("引継ぎ後、ゲストのデータはユーザーのものになり、created_at は変わらない", async () => {
    const guestId = newGuestId();
    const video = await insertVideo({ guestId, createdAt: ago(2 * HOUR_MS) });
    const children = await insertChildren(video.id);
    const user = await createTestUser();

    expect(await migrateGuestVideosToUser(guestId, user.userId)).toBe(1);

    const after = await admin.from("videos").select("*").eq("id", video.id).single();
    expect(after.data!.user_id).toBe(user.userId);
    expect(after.data!.guest_id).toBeNull();
    expect(new Date(after.data!.created_at).getTime()).toBe(
      new Date(video.created_at).getTime(),
    );

    // ユーザーとして読める（RLS を通る）。子テーブルも、videos の所有者が変わっただけで付いてくる。
    const userOwner: Owner = { kind: "user", userId: user.userId, client: user.client };
    expect((await findOwnedVideo(userOwner, video.id))?.id).toBe(video.id);
    const comments = await listCommentThreadsOfOwnedVideo(userOwner, video.id);
    expect(comments?.threads.map((c) => c.id)).toEqual([children.commentId]);
    const analysis = await user.client.from("comment_analysis").select("id");
    expect(analysis.data?.map((a) => a.id)).toEqual([children.analysisId]);

    // 元のゲストからは、もう見えない。
    const guestOwner: Owner = { kind: "guest", guestId };
    expect(await findOwnedVideo(guestOwner, video.id)).toBeNull();
  });

  it("期限切れ（24時間超）のゲスト動画は引継がない", async () => {
    const guestId = newGuestId();
    const video = await insertVideo({ guestId, createdAt: ago(25 * HOUR_MS) });
    const user = await createTestUser();

    expect(await migrateGuestVideosToUser(guestId, user.userId)).toBe(0);

    const after = await admin.from("videos").select("*").eq("id", video.id).single();
    expect(after.data!.user_id).toBeNull();
    expect(after.data!.guest_id).toBe(guestId);
  });
});
