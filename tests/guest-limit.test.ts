import { afterAll, describe, expect, it } from "vitest";

import { admin, cleanup, createTestUser, insertVideo, newGuestId } from "./helpers/db";

// ゲストは同時に1本まで（要件定義書3.1）。アプリのチェックをすり抜けても、
// 部分ユニークインデックス idx_videos_guest_id_unique で DB が拒否することを確かめる。
describe("ゲストの動画は同時に1本まで", () => {
  afterAll(cleanup);

  it("同じゲストの2本目の動画は、ユニーク制約違反になる", async () => {
    const guestId = newGuestId();
    await insertVideo({ guestId });

    // PostgreSQL のエラーコード 23505 = unique_violation
    await expect(insertVideo({ guestId })).rejects.toMatchObject({ code: "23505" });

    const { data } = await admin.from("videos").select("id").eq("guest_id", guestId);
    expect(data).toHaveLength(1);
  });

  it("別のゲストなら、それぞれ1本ずつ作れる", async () => {
    await insertVideo({ guestId: newGuestId() });
    await insertVideo({ guestId: newGuestId() });
  });

  it("ログインユーザーは複数の動画を持てる（部分インデックスの対象外）", async () => {
    const user = await createTestUser();
    await insertVideo({ userId: user.userId });
    await insertVideo({ userId: user.userId });
  });

  it("user_id と guest_id の両方あり・両方なしは CHECK 制約違反になる", async () => {
    const user = await createTestUser();
    // 23514 = check_violation
    await expect(
      insertVideo({ userId: user.userId, guestId: newGuestId() }),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(insertVideo({})).rejects.toMatchObject({ code: "23514" });
  });
});
