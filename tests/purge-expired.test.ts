import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { purgeExpiredVideos } from "@/server/purge-expired";

import {
  DAY_MS,
  admin,
  HOUR_MS,
  ago,
  cleanup,
  createTestUser,
  exists,
  insertChildren,
  insertVideo,
  newGuestId,
} from "./helpers/db";

const MINUTE_MS = 60 * 1000;

describe("期限切れ削除ジョブ", () => {
  const now = new Date();
  let guestExpired: string;
  let guestExpiredChildren: Awaited<ReturnType<typeof insertChildren>>;
  let guestAlive: string;
  let userExpired: string;
  let userExpiredChildren: Awaited<ReturnType<typeof insertChildren>>;
  let userAlive: string;
  let userOlderThanGuestPeriod: string;
  let result: Awaited<ReturnType<typeof purgeExpiredVideos>>;
  let usageExpired: string;
  let usageAlive: string;

  beforeAll(async () => {
    const user = await createTestUser();

    // 境界の少し外側（期限切れ）と、少し内側（期限内）を作る。
    guestExpired = (
      await insertVideo({ guestId: newGuestId(), createdAt: ago(24 * HOUR_MS + MINUTE_MS, now) })
    ).id;
    guestAlive = (
      await insertVideo({ guestId: newGuestId(), createdAt: ago(24 * HOUR_MS - MINUTE_MS, now) })
    ).id;
    userExpired = (
      await insertVideo({ userId: user.userId, createdAt: ago(29 * DAY_MS + MINUTE_MS, now) })
    ).id;
    userAlive = (
      await insertVideo({ userId: user.userId, createdAt: ago(29 * DAY_MS - MINUTE_MS, now) })
    ).id;
    // ゲストの期間（24時間）は過ぎているが、ユーザーの期間（29日）内の動画
    userOlderThanGuestPeriod = (
      await insertVideo({ userId: user.userId, createdAt: ago(25 * HOUR_MS, now) })
    ).id;

    guestExpiredChildren = await insertChildren(guestExpired);
    userExpiredChildren = await insertChildren(userExpired);
    await insertChildren(guestAlive);
    await insertChildren(userAlive);

    // API使用量の記録（保持期間は90日）。guest_id を付けておくと、残った行は cleanup() で消える。
    const usageGuestId = newGuestId();
    const usage = await admin
      .from("api_usage_logs")
      .insert([
        { service: "youtube", endpoint: "videos.list", succeeded: true, guest_id: usageGuestId, created_at: ago(90 * DAY_MS + MINUTE_MS, now) },
        { service: "youtube", endpoint: "videos.list", succeeded: true, guest_id: usageGuestId, created_at: ago(90 * DAY_MS - MINUTE_MS, now) },
      ])
      .select("id");
    if (usage.error) throw usage.error;
    [usageExpired, usageAlive] = usage.data.map((r) => r.id);

    result = await purgeExpiredVideos(now);
  });

  afterAll(cleanup);

  it("ゲストは24時間を超えた動画が削除され、24時間以内の動画は残る", async () => {
    expect(await exists("videos", guestExpired)).toBe(false);
    expect(await exists("videos", guestAlive)).toBe(true);
  });

  it("ログインユーザーは29日を超えた動画が削除され、29日以内の動画は残る", async () => {
    expect(await exists("videos", userExpired)).toBe(false);
    expect(await exists("videos", userAlive)).toBe(true);
    expect(await exists("videos", userOlderThanGuestPeriod)).toBe(true);
  });

  it("削除された動画の子テーブルも連鎖して削除される（ON DELETE CASCADE）", async () => {
    for (const children of [guestExpiredChildren, userExpiredChildren]) {
      expect(await exists("comments", children.commentId)).toBe(false);
      expect(await exists("comment_analysis", children.analysisId)).toBe(false);
      expect(await exists("comment_topics", children.topicId)).toBe(false);
      expect(await exists("comment_groups", children.groupId)).toBe(false);
      expect(await exists("advice_logs", children.adviceId)).toBe(false);
    }
  });

  it("API使用量の記録は、90日を超えたものが削除され、90日以内のものは残る", async () => {
    const { data, error } = await admin
      .from("api_usage_logs")
      .select("id")
      .in("id", [usageExpired, usageAlive]);
    if (error) throw error;
    expect(data.map((r) => r.id)).toEqual([usageAlive]);
  });

  it("削除件数を返す", () => {
    // 他のテストの残りがあっても壊れないよう、最低件数で確かめる。
    expect(result.guestVideos).toBeGreaterThanOrEqual(1);
    expect(result.userVideos).toBeGreaterThanOrEqual(1);
    expect(result.usageLogs).toBeGreaterThanOrEqual(1);
  });
});
