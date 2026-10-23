import "server-only";

import { cookies } from "next/headers";

import { GUEST_RETENTION_HOURS } from "@/lib/config/retention";
import { isUuid } from "@/lib/uuid";

// =============================================================
// ゲストの識別（要件定義書3.1）
//
// ゲストはログインしないので、ブラウザごとに UUID を発行して Cookie に保存し、
// その値を videos.guest_id に入れることで「このブラウザのデータ」を区別する。
//
// Cookie の属性
//   - httpOnly：JavaScript（document.cookie）から読めない。XSS で guest_id を盗まれて、
//     他人がそのゲストになりすますのを防ぐ。
//   - secure：本番（HTTPS）では HTTPS のときだけ送る。ローカルの http://localhost でも動くよう開発時は外す。
//   - sameSite=lax：他サイトから埋め込まれたリクエスト（CSRF）では送らない。通常のリンク遷移では送る。
//   - maxAge：24時間（DB のゲストデータの保持期間と同じ）。
//
// 有効期限の起点（ユーザーと決定）：ゲストが動画を作成した時点で Cookie を（再）発行する。
// 初回訪問時に発行すると、訪問の20時間後に動画を作った場合に、データより先に Cookie が4時間で切れてしまうため。
// 発行するのは、動画の登録が成功したとき（POST /api/videos）。失敗したときは発行しない。
// =============================================================

export const GUEST_COOKIE_NAME = "guest_id";

/**
 * Cookie の guest_id を読む。無い、または形式が不正なら null。
 * Cookie はブラウザ側で書き換えられるので、UUID の形式でない値は信用しない。
 * 期限（24時間）を過ぎた Cookie は、ブラウザが送ってこないので、ここに来るのは期限内のものだけ。
 */
export async function readGuestId(): Promise<string | null> {
  const value = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
  return isUuid(value) ? value : null;
}

/**
 * ゲストが動画を作成したときに呼ぶ。
 * guestId は、既存の Cookie の値か、登録の前に新しく作った UUID（src/app/api/videos/route.ts）。
 * どちらの場合も Cookie を書き直して、有効期限を「今から24時間」にそろえる。
 */
export async function issueGuestCookie(guestId: string): Promise<void> {
  (await cookies()).set(GUEST_COOKIE_NAME, guestId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_RETENTION_HOURS * 60 * 60,
  });
}

/** ログインへの引継ぎ後に呼ぶ。以後このブラウザはゲストとして扱わない。 */
export async function clearGuestCookie(): Promise<void> {
  (await cookies()).delete(GUEST_COOKIE_NAME);
}
