import { NextResponse } from "next/server";

import { findOwnedVideo } from "@/server/access";
import { getRequestOwner } from "@/server/owner";

// GET /api/videos/:id：動画1件
// 他人の動画・期限切れ・存在しない、はすべて同じ 404 にする（存在を推測させないため）。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await getRequestOwner();
  const video = owner ? await findOwnedVideo(owner, id) : null;
  if (!video) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ video });
}
