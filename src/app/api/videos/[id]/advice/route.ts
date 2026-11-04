import { NextResponse } from "next/server";

import { getAdviceOfOwnedVideo } from "@/server/access";
import { getRequestOwner } from "@/server/owner";

// GET /api/videos/:id/advice：動画のAIアドバイス（要件定義書4.4、12章）
// 成功：{ status, state, advice: { summary, text, generatedAt } | null }（src/lib/advice.ts の VideoAdvice）
// 他人の動画・期限切れ・存在しない：404（動画の取得 API と同じ）。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await getRequestOwner();
  const advice = owner ? await getAdviceOfOwnedVideo(owner, id) : null;
  if (!advice) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(advice);
}
