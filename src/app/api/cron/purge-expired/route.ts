import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { serverEnv } from "@/server/env";
import { purgeExpiredVideos } from "@/server/purge-expired";

// =============================================================
// GET /api/cron/purge-expired：期限切れ削除ジョブの入口
//
// スケジュール方式（ユーザーと決定）：Supabase の pg_cron と pg_net で、1時間ごとにこの URL を呼ぶ。
// 削除の本体を TypeScript に置くことで、保持期間の定数を1か所（src/lib/config/retention.ts）で管理できる。
// pg_cron の登録はデプロイ先の URL が必要なため、デプロイのスライスで行う。
//
// 誰でも呼べる URL なので、Authorization: Bearer <CRON_SECRET> を持つ呼び出しだけを受け付ける。
// =============================================================

function isAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  // 文字列を === で比べると、一致した文字数によって処理時間がわずかに変わり、
  // それを計測して秘密を1文字ずつ推測される（タイミング攻撃）おそれがある。
  // 両方をハッシュして長さをそろえ、比較時間が一定の timingSafeEqual で比べる。
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await purgeExpiredVideos();
  // 件数だけを記録する（コメント本文や秘密情報はログに出さない。要件定義書16章、17.2）。
  console.info("[purge-expired]", result);
  return NextResponse.json(result);
}
