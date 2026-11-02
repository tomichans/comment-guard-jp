import { NextResponse } from "next/server";

import { getRankingsOfOwnedVideo } from "@/server/access";
import { getRequestOwner } from "@/server/owner";

// GET /api/videos/:id/rankings：指摘・要望ランキングと質問ランキング（上位3件ずつ。要件定義書4.4、11章）
// 成功：{ status, feedbackRequest: [{ rank, text, count }], question: [...] }（src/lib/rankings.ts の VideoRankings）
// 他人の動画・期限切れ・存在しない：404（動画の取得 API と同じ）。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await getRequestOwner();
  const rankings = owner ? await getRankingsOfOwnedVideo(owner, id) : null;
  if (!rankings) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(rankings);
}
