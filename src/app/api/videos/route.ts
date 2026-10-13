import { NextResponse } from "next/server";

import { listOwnedVideos } from "@/server/access";
import { getRequestOwner } from "@/server/owner";

// GET /api/videos：自分の動画一覧（左ペインの「動画一覧」の元データ）
export async function GET() {
  const owner = await getRequestOwner();
  // まだ何も作っていない訪問者は、空の一覧（エラーにはしない）。
  if (!owner) return NextResponse.json({ videos: [] });

  const videos = await listOwnedVideos(owner);
  return NextResponse.json({ videos });
}
