import { NextResponse } from "next/server";

import {
  deleteOwnedVideo,
  findOwnedVideo,
  getAnalysisSummaryOfOwnedVideo,
} from "@/server/access";
import { getRequestOwner } from "@/server/owner";

// GET /api/videos/:id：動画1件と、コメントの分析の進み具合
// 成功：{ video, analysis: { status, total, analyzed, counts } }（analysis は src/server/access.ts の AnalysisSummary）
// 他人の動画・期限切れ・存在しない、はすべて同じ 404 にする（存在を推測させないため）。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await getRequestOwner();
  const video = owner ? await findOwnedVideo(owner, id) : null;
  const analysis = owner && video ? await getAnalysisSummaryOfOwnedVideo(owner, video.id) : null;
  if (!video || !analysis) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ video, analysis });
}

// DELETE /api/videos/:id：自分の動画を削除する（要件定義書18.2）
// 成功：204（中身なし）。コメントや分析結果なども連鎖して削除される。
// ゲスト・未ログイン：403 login_required（ID は見ずに返すので、他人の動画の存在は分からない）。
// 他人の動画・期限切れ・存在しない：GET と同じ 404。
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await getRequestOwner();
  if (owner?.kind !== "user") {
    return NextResponse.json(
      { error: "login_required", message: "動画の削除は、ログインすると利用できます" },
      { status: 403 },
    );
  }

  const deleted = await deleteOwnedVideo(owner, id);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
