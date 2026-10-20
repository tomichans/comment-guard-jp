import { NextResponse } from "next/server";

import { listCommentsOfOwnedVideo } from "@/server/access";
import { getRequestOwner } from "@/server/owner";

// GET /api/videos/:id/comments：動画のコメント一覧
// ページネーション（要件定義書17.1）は、コメント一覧の画面を作るスライスで追加する。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await getRequestOwner();
  const comments = owner ? await listCommentsOfOwnedVideo(owner, id) : null;
  if (!comments) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ comments });
}
