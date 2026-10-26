import { after, NextResponse } from "next/server";

import { retryAnalysis } from "@/server/analysis/analyze";
import { getRequestOwner } from "@/server/owner";

// 裏で行う分析を含めて、1回のリクエストで続けられる最大の時間（秒）。POST /api/videos と同じ。
export const maxDuration = 300;

// POST /api/videos/:id/analyze：分析をやり直す（画面の「分析をやり直す」ボタン。要件定義書15.2）
// 分析に失敗した（または途中で止まった）自分の動画で、まだ分析されていないコメントだけを分析する。
// 成功：202（受け付けた。分析はレスポンスの後に裏で行う）
// 分析中・完了の動画：409 not_failed
// 他人の動画・期限切れ・存在しない：404（動画の取得 API と同じ）
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await getRequestOwner();
  const result = owner ? await retryAnalysis(owner, id) : "not_found";

  if (result === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (result === "not_failed") {
    return NextResponse.json(
      { error: "not_failed", message: "この動画は、分析中か、分析が完了しています" },
      { status: 409 },
    );
  }
  after(result);
  return new NextResponse(null, { status: 202 });
}
