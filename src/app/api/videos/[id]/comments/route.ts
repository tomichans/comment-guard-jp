import { NextResponse } from "next/server";

import { isCommentTab } from "@/lib/comment-categories";
import { COMMENT_SEARCH_MAX_LENGTH, isCommentSort } from "@/lib/comment-list";
import { listCommentThreadsOfOwnedVideo } from "@/server/access";
import { getRequestOwner } from "@/server/owner";

// GET /api/videos/:id/comments：動画のコメント一覧（スレッドの形で、50件ずつ）
// クエリ
//   tab    … 親コメントの分類（praise、question、feedback、negative_opinion、spam、harmful、all。省略時は all）
//   sort   … newest（新しい順。省略時）、likes（いいねが多い順）、replies（返信が多い順）
//   q      … 親コメントの本文の検索語（部分一致）
//   offset … 続きを読み込むときに、前の応答の nextOffset を渡す
// 成功：{ threads, total, nextOffset }。nextOffset が null なら最後まで読み込んだ。
// 他人の動画・期限切れ・存在しない：404（動画の取得 API と同じ）。
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const sort = search.get("sort");
  const tab = search.get("tab");
  const offset = Number(search.get("offset") ?? 0);

  const owner = await getRequestOwner();
  const page = owner
    ? await listCommentThreadsOfOwnedVideo(owner, id, {
        // おかしな値が来たら、エラーにせず既定の値で返す。
        sort: isCommentSort(sort) ? sort : undefined,
        tab: isCommentTab(tab) ? tab : undefined,
        q: (search.get("q") ?? "").trim().slice(0, COMMENT_SEARCH_MAX_LENGTH),
        offset: Number.isSafeInteger(offset) && offset > 0 ? offset : 0,
      })
    : null;
  if (!page) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(page);
}
