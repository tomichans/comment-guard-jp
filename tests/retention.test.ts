import { describe, expect, it } from "vitest";

import {
  GUEST_RETENTION_HOURS,
  USER_RETENTION_DAYS,
  isExpired,
} from "@/lib/config/retention";

import { DAY_MS, HOUR_MS } from "./helpers/time";

// 期限判定の純関数のテスト（DB 不要）。境界の前後で判定が切り替わることを確かめる。
describe("isExpired（保持期間の判定）", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("定数の初期値は 24時間 / 29日", () => {
    expect(GUEST_RETENTION_HOURS).toBe(24);
    expect(USER_RETENTION_DAYS).toBe(29);
  });

  it("ゲスト：24時間ちょうどは期限内、それを超えたら期限切れ", () => {
    expect(isExpired({ created_at: at(24 * HOUR_MS), user_id: null }, now)).toBe(false);
    expect(isExpired({ created_at: at(24 * HOUR_MS + 1), user_id: null }, now)).toBe(true);
  });

  it("ログインユーザー：29日ちょうどは期限内、それを超えたら期限切れ", () => {
    const user = "00000000-0000-0000-0000-000000000001";
    expect(isExpired({ created_at: at(29 * DAY_MS), user_id: user }, now)).toBe(false);
    expect(isExpired({ created_at: at(29 * DAY_MS + 1), user_id: user }, now)).toBe(true);
    // ゲストの期間（24時間）を過ぎていても、ユーザーの動画なら期限内
    expect(isExpired({ created_at: at(25 * HOUR_MS), user_id: user }, now)).toBe(false);
  });
});
