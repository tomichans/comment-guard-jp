import { afterAll, describe, expect, it } from "vitest";

import {
  findOwnedVideo,
  listCommentThreadsOfOwnedVideo,
  listOwnedVideos,
  type Owner,
} from "@/server/access";
import { migrateGuestVideosToUser } from "@/server/migrate-guest";

import {
  DAY_MS,
  HOUR_MS,
  admin,
  ago,
  cleanup,
  createTestUser,
  exists,
  insertChildren,
  insertVideo,
  newGuestId,
} from "./helpers/db";

// 削除ジョブは1時間ごとなので、期限を過ぎてから最大1時間ほどは DB に行が残る。
// その間も、読み取り時の判定で「見つからない」になることを確かめる。
describe("読み取り時の期限判定", () => {
  afterAll(cleanup);

  it("期限切れの動画は、削除ジョブの実行前でも取得できない", async () => {
    const guestId = newGuestId();
    const owner: Owner = { kind: "guest", guestId };
    const video = await insertVideo({ guestId, createdAt: ago(25 * HOUR_MS) });
    await insertChildren(video.id);

    // DB には残っているが……
    expect(await exists("videos", video.id)).toBe(true);
    // アプリからは見えない
    expect(await findOwnedVideo(owner, video.id)).toBeNull();
    expect(await listCommentThreadsOfOwnedVideo(owner, video.id)).toBeNull();
    expect(await listOwnedVideos(owner)).toEqual([]);
  });

  it("ログインユーザーも、29日を超えた動画は取得できない", async () => {
    const user = await createTestUser();
    const owner: Owner = { kind: "user", userId: user.userId, client: user.client };
    const video = await insertVideo({ userId: user.userId, createdAt: ago(29 * DAY_MS + HOUR_MS) });

    expect(await findOwnedVideo(owner, video.id)).toBeNull();
    expect(await listOwnedVideos(owner)).toEqual([]);
  });

  it("引継ぎ後はユーザーの期間（29日）が適用され、起点の created_at は変わらない", async () => {
    const guestId = newGuestId();
    const video = await insertVideo({ guestId, createdAt: ago(23 * HOUR_MS) });
    const createdAt = new Date(video.created_at);
    const user = await createTestUser();
    await migrateGuestVideosToUser(guestId, user.userId);

    const after = await admin.from("videos").select("created_at").eq("id", video.id).single();
    expect(new Date(after.data!.created_at).getTime()).toBe(createdAt.getTime());

    const owner: Owner = { kind: "user", userId: user.userId, client: user.client };
    const at = (ms: number) => new Date(createdAt.getTime() + ms);

    // ゲストのままなら消えている「作成から25時間後」でも、引継ぎ後は見える。
    expect((await findOwnedVideo(owner, video.id, at(25 * HOUR_MS)))?.id).toBe(video.id);
    expect((await listOwnedVideos(owner, at(25 * HOUR_MS))).map((v) => v.id)).toEqual([video.id]);
    // 起点は元の created_at のままなので、そこから29日を超えたら見えなくなる。
    expect(await findOwnedVideo(owner, video.id, at(29 * DAY_MS + HOUR_MS))).toBeNull();
    expect(await listOwnedVideos(owner, at(29 * DAY_MS + HOUR_MS))).toEqual([]);
  });
});
