import "server-only";

import {
  GUEST_DAILY_VIDEO_LIMIT,
  GUEST_MAX_THREADS,
  THREADS_PER_PAGE,
  USER_MAX_THREADS,
} from "@/lib/config/limits";
import { isExpired } from "@/lib/config/retention";
import type { Tables } from "@/lib/database.types";
import { parseYouTubeVideoId } from "@/lib/youtube-url";
import { saveComments } from "@/server/comments/save";
import { createAdminClient, type AdminClient } from "@/server/supabase/admin";
import { withYouTubeUsage, type UsageContext } from "@/server/usage";
import { VideoError } from "@/server/video-errors";
import { youtubeApi, type YouTubeApi } from "@/server/youtube/client";

// =============================================================
// 動画の登録とコメントの取得（要件定義書5章、6章、7章）
//
// 流れ
//   1. URL を検証して動画IDを取り出す
//   2. ゲストなら上限を確認する（同時に1本、IP単位の1日あたりの回数）
//   3. YouTube から動画情報を取得する
//   4. YouTube から最新のコメント（最大100スレッド）を取得する
//   5. videos とコメントを保存する
//   6. ログインユーザーで続きがあれば、残り（最大900スレッド）を後から取得する（fetchRemaining）
//
// 3と4を videos の保存より先にしているのは、「動画が見つからない」「コメントが無効」などの
// エラーのときに、中身のない動画が残らないようにするため（ゲストの1本の枠も消費しない）。
//
// 残りの取得方法【確定】：Next.js の after() で、レスポンスを返した後に同じサーバー処理の続きとして実行する。
// この関数は「残りを取得する関数」を返すだけで、after() に渡すのは API Route（呼び出し側）の役目。
// テストでは、返された関数をそのまま await して確かめられる。
// =============================================================

export type Video = Tables<"videos">;

/** 動画を登録する人。ゲストは、IP単位の上限のために ipHash を持つ（分からなければ null）。 */
export type Registrant =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestId: string; ipHash: string | null };

export type RegisterResult = {
  video: Video;
  /** 残りのコメントを取得する関数。続きがなければ null。 */
  fetchRemaining: (() => Promise<void>) | null;
};

export async function registerVideo(
  registrant: Registrant,
  url: string,
  youtube: YouTubeApi = youtubeApi,
  now: Date = new Date(),
): Promise<RegisterResult> {
  const youtubeVideoId = parseYouTubeVideoId(url);
  if (!youtubeVideoId) throw new VideoError("invalid_url");

  const admin = createAdminClient();
  if (registrant.kind === "guest") {
    await assertGuestCanRegister(admin, registrant, now);
  }

  // 動画の内部 id を先に決めておき、保存前の API 呼び出しも、この動画の使用量として記録する。
  const ctx: UsageContext = {
    videoId: crypto.randomUUID(),
    userId: registrant.kind === "user" ? registrant.userId : null,
    guestId: registrant.kind === "guest" ? registrant.guestId : null,
    ipHash: registrant.kind === "guest" ? registrant.ipHash : null,
  };

  const info = await withYouTubeUsage(ctx, "videos.list", () =>
    youtube.getVideo(youtubeVideoId),
  );
  if (!info) throw new VideoError("video_not_found");

  const maxThreads = registrant.kind === "guest" ? GUEST_MAX_THREADS : USER_MAX_THREADS;
  const firstPage = await withYouTubeUsage(ctx, "commentThreads.list", () =>
    youtube.listCommentThreads(youtubeVideoId, {
      maxResults: Math.min(THREADS_PER_PAGE, maxThreads),
    }),
  );
  const hasMore =
    firstPage.nextPageToken !== null && firstPage.threadCount < maxThreads;

  const { data: video, error } = await admin
    .from("videos")
    .insert({
      id: ctx.videoId,
      user_id: ctx.userId,
      guest_id: ctx.guestId,
      source_id: await youtubeSourceId(admin),
      video_id: info.videoId,
      title: info.title,
      thumbnail_url: info.thumbnailUrl,
      published_at: info.publishedAt,
      fetch_status: hasMore ? "fetching" : "done",
    })
    .select()
    .single();
  // 23505 = unique_violation。同じゲストが同時に2回登録した場合、DB の部分ユニークインデックスが2本目を拒否する。
  if (error?.code === "23505") throw new VideoError("guest_video_limit");
  if (error) throw error;

  try {
    await saveComments(admin, video.id, firstPage.comments);
  } catch (e) {
    // コメントのない動画を残さない（videos を消せば、保存済みのコメントも CASCADE で消える）。
    await admin.from("videos").delete().eq("id", video.id);
    throw e;
  }

  const fetchRemaining = hasMore
    ? () =>
        fetchRemainingComments({
          admin,
          youtube,
          ctx,
          youtubeVideoId,
          pageToken: firstPage.nextPageToken!,
          fetchedThreads: firstPage.threadCount,
          maxThreads,
        })
    : null;

  return { video, fetchRemaining };
}

/**
 * 2ページ目以降のコメントを取得して保存し、最後に fetch_status を done（失敗なら failed）にする。
 * 途中で失敗しても、それまでに保存したコメントは残す（画面では取得済みの分を表示できる）。
 */
export async function fetchRemainingComments(opts: {
  admin: AdminClient;
  youtube: YouTubeApi;
  ctx: UsageContext;
  youtubeVideoId: string;
  pageToken: string;
  fetchedThreads: number;
  maxThreads: number;
}): Promise<void> {
  const { admin, youtube, ctx, youtubeVideoId, maxThreads } = opts;
  let pageToken: string | null = opts.pageToken;
  let fetched = opts.fetchedThreads;
  let status: "done" | "failed" = "done";

  try {
    while (pageToken && fetched < maxThreads) {
      const token: string = pageToken;
      const page = await withYouTubeUsage(ctx, "commentThreads.list", () =>
        youtube.listCommentThreads(youtubeVideoId, {
          maxResults: Math.min(THREADS_PER_PAGE, maxThreads - fetched),
          pageToken: token,
        }),
      );
      await saveComments(admin, ctx.videoId, page.comments);
      fetched += page.threadCount;
      pageToken = page.nextPageToken;
    }
  } catch (e) {
    status = "failed";
    // エラーの種類だけを記録する（コメント本文や API キーはログに出さない。要件定義書16章）。
    const reason = e instanceof VideoError ? e.code : e instanceof Error ? e.message : "unknown";
    console.error("[fetch-comments] 残りのコメントの取得に失敗しました", {
      videoId: ctx.videoId,
      reason,
    });
  }

  // 取得中に動画が削除された場合は、更新する行がないだけで、エラーにはならない。
  const { error } = await admin
    .from("videos")
    .update({ fetch_status: status })
    .eq("id", ctx.videoId);
  if (error) console.error("[fetch-comments] fetch_status の更新に失敗しました", error.message);
}

/**
 * ゲストの上限（要件定義書3.1）を確認する。超えていれば VideoError を投げる。
 *   - 同時に保持できる動画は1本まで
 *   - 同じIPから、直近24時間に動画を登録しようとできる回数（GUEST_DAILY_VIDEO_LIMIT）
 */
async function assertGuestCanRegister(
  admin: AdminClient,
  guest: Extract<Registrant, { kind: "guest" }>,
  now: Date,
): Promise<void> {
  const { data: videos, error } = await admin
    .from("videos")
    .select("id, created_at, user_id")
    .eq("guest_id", guest.guestId);
  if (error) throw error;
  if (videos.some((v) => !isExpired(v, now))) {
    throw new VideoError("guest_video_limit");
  }
  // 期限切れで、まだ削除ジョブに消されていない動画が残っていると、ユニーク制約で新しい動画を作れない。
  // 期限切れは「存在しない」扱い（要件定義書3.3）なので、ここで消してから進む。
  if (videos.length > 0) {
    const del = await admin.from("videos").delete().eq("guest_id", guest.guestId);
    if (del.error) throw del.error;
  }

  if (guest.ipHash) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await admin
      .from("api_usage_logs")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", guest.ipHash)
      .eq("endpoint", "videos.list")
      .gte("created_at", since);
    if (countError) throw countError;
    if ((count ?? 0) >= GUEST_DAILY_VIDEO_LIMIT) {
      throw new VideoError("guest_daily_limit");
    }
  }
}

async function youtubeSourceId(admin: AdminClient): Promise<string> {
  const { data, error } = await admin
    .from("sources")
    .select("id")
    .eq("name", "youtube")
    .single();
  if (error) throw error;
  return data.id;
}
