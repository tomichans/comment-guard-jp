import "server-only";

import { createHmac } from "node:crypto";

import { serverEnv } from "@/server/env";

// =============================================================
// ゲストのIPアドレスの扱い（要件定義書3.1のIP単位の上限）
//
// IPアドレスは個人に結びつきうる情報なので、そのまま DB に保存しない。
// 秘密の鍵（IP_HASH_SECRET）を使った HMAC-SHA256 で変換した値だけを保存する。
// 鍵なしの単純なハッシュ（SHA-256）だと、IPv4 は約43億通りしかないため、
// 全部のIPを総当たりで変換して、元のIPを逆算できてしまう。鍵を知らなければ、それができない。
// 「同じIPかどうか」は、変換後の値が同じかどうかで判定できる。
// =============================================================

/**
 * リクエストの送信元IPを取り出す。分からなければ null。
 * Vercel では x-real-ip に送信元IPが入る（ブラウザが偽装した値は Vercel が上書きする）。
 * ヘッダーがない環境では null になり、IP単位の上限はかからない。
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

export function hashIp(ip: string): string {
  return createHmac("sha256", serverEnv.ipHashSecret).update(ip).digest("hex");
}
