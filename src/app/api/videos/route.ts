import { after, NextResponse } from "next/server";

import { listOwnedVideos } from "@/server/access";
import { issueGuestCookie } from "@/server/guest";
import { clientIp, hashIp } from "@/server/ip";
import { getRequestOwner } from "@/server/owner";
import { VIDEO_ERRORS, VideoError } from "@/server/video-errors";
import { registerVideo, type Registrant } from "@/server/videos/register";

// GET /api/videos：自分の動画一覧（左ペインの「動画一覧」の元データ）
export async function GET() {
  const owner = await getRequestOwner();
  // まだ何も作っていない訪問者は、空の一覧（エラーにはしない）。
  if (!owner) return NextResponse.json({ videos: [] });

  const videos = await listOwnedVideos(owner);
  return NextResponse.json({ videos });
}

// POST /api/videos：YouTube の URL から動画を登録し、コメントを取得する
// リクエスト：{ "url": "https://www.youtube.com/watch?v=..." }
// 成功：201 { video }。video.fetch_status が "fetching" なら、残りのコメントを取得中。
// 失敗：{ error: エラーコード, message: 画面に出す日本語 }（コードと HTTP ステータスは src/server/video-errors.ts）
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : "";

  const owner = await getRequestOwner();
  let registrant: Registrant;
  if (owner?.kind === "user") {
    registrant = { kind: "user", userId: owner.userId };
  } else {
    // Cookie がまだない初回のゲストには、ここで新しい guest_id を作る。
    // Cookie に書くのは登録が成功してから（失敗したときに、空のゲストを作らないため）。
    const ip = clientIp(request.headers);
    registrant = {
      kind: "guest",
      guestId: owner?.guestId ?? crypto.randomUUID(),
      ipHash: ip ? hashIp(ip) : null,
    };
  }

  try {
    const { video, fetchRemaining } = await registerVideo(registrant, url);

    // ゲストの Cookie は、動画を作成した時点から24時間（要件定義書3.1）。
    if (registrant.kind === "guest") await issueGuestCookie(registrant.guestId);

    // 残りのコメント（ログインユーザーのみ、最大900スレッド）は、レスポンスを返した後に取得する。
    // after() は Next.js の機能で、ブラウザには先に結果を返し、その後も同じサーバー処理を続けられる。
    // 画面は GET /api/videos/:id の fetch_status が "done" になるまで、「取得中」を表示できる。
    if (fetchRemaining) after(fetchRemaining);

    return NextResponse.json({ video }, { status: 201 });
  } catch (e) {
    if (e instanceof VideoError) {
      const { status, message } = VIDEO_ERRORS[e.code];
      return NextResponse.json({ error: e.code, message }, { status });
    }
    throw e;
  }
}
