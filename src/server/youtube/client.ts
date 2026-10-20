import "server-only";

import { serverEnv } from "@/server/env";
import { VideoError } from "@/server/video-errors";

// =============================================================
// YouTube Data API v3 の呼び出し（要件定義書6章、7章）
//
// API の生の応答（JSON）は、ここで必要な項目だけの型（YouTubeVideo、YouTubeComment）に変換する。
// 他のファイルは YouTube の応答の形を知らなくてよい（raw_payload を持たない方針。要件定義書13.2）。
//
// 呼び出す側は YouTubeApi という「型（インターフェース）」だけに依存する。
// テストでは、本物の代わりに決まった応答を返す偽物を渡せるようにするため。
// =============================================================

export type YouTubeVideo = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
};

export type YouTubeComment = {
  externalId: string;
  /** 返信なら親コメントの YouTube 側のID。親コメントなら null。 */
  parentExternalId: string | null;
  text: string;
  author: string | null;
  likeCount: number | null;
  postedAt: string | null;
};

export type CommentThreadPage = {
  /** 親コメントと、それに同梱された返信（親が先、返信が後の順） */
  comments: YouTubeComment[];
  /** このページのスレッド（親コメント）の数 */
  threadCount: number;
  /** 次のページがあればそのトークン。最後のページなら null。 */
  nextPageToken: string | null;
};

export interface YouTubeApi {
  /** 動画情報を取得する。存在しない・非公開なら null。 */
  getVideo(videoId: string): Promise<YouTubeVideo | null>;
  /** コメントスレッドを新しい順に1ページ取得する。 */
  listCommentThreads(
    videoId: string,
    opts: { maxResults: number; pageToken?: string },
  ): Promise<CommentThreadPage>;
}

const BASE_URL = "https://www.googleapis.com/youtube/v3";

// ---- YouTube API の応答のうち、使う部分だけの型 ----

type CommentSnippet = {
  textDisplay?: string;
  authorDisplayName?: string;
  likeCount?: number;
  publishedAt?: string;
  parentId?: string;
};

type CommentThreadsResponse = {
  nextPageToken?: string;
  items?: {
    snippet: { topLevelComment: { id: string; snippet: CommentSnippet } };
    // commentThreads.list に同梱される返信は一部だけ（要件定義書7.3）。全件取得は将来機能。
    replies?: { comments?: { id: string; snippet: CommentSnippet }[] };
  }[];
};

type VideosResponse = {
  items?: {
    id: string;
    snippet: {
      title: string;
      publishedAt?: string;
      thumbnails?: Record<string, { url: string } | undefined>;
    };
  }[];
};

/** YouTube API を呼び、エラーなら VideoError に変換して投げる。 */
async function callApi<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${BASE_URL}/${path}?${new URLSearchParams(params)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      // APIキーは URL（?key=）ではなくヘッダーで送る。URL はログやエラーメッセージに出やすいため。
      headers: { "X-Goog-Api-Key": serverEnv.youtubeApiKey },
      cache: "no-store",
    });
  } catch {
    // 通信自体の失敗（DNS、タイムアウトなど）
    throw new VideoError("youtube_error");
  }

  if (response.ok) return (await response.json()) as T;

  // エラーの理由は error.errors[0].reason に入っている（例：commentsDisabled、quotaExceeded）。
  const body = (await response.json().catch(() => null)) as {
    error?: { errors?: { reason?: string }[] };
  } | null;
  const reason = body?.error?.errors?.[0]?.reason;
  throw new VideoError(errorCodeFor(response.status, reason));
}

/** YouTube API の HTTP ステータスと理由を、このアプリのエラーコードに変換する。 */
export function errorCodeFor(status: number, reason: string | undefined) {
  if (reason === "commentsDisabled") return "comments_disabled" as const;
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
    return "quota_exceeded" as const;
  }
  if (status === 404 || reason === "videoNotFound") return "video_not_found" as const;
  return "youtube_error" as const;
}

function toComment(
  id: string,
  snippet: CommentSnippet,
  parentExternalId: string | null,
): YouTubeComment {
  return {
    externalId: id,
    parentExternalId,
    text: snippet.textDisplay ?? "",
    author: snippet.authorDisplayName ?? null,
    likeCount: snippet.likeCount ?? null,
    postedAt: snippet.publishedAt ?? null,
  };
}

/** commentThreads.list の応答を、親コメント→返信の順の配列に変換する。 */
export function toCommentThreadPage(data: CommentThreadsResponse): CommentThreadPage {
  const items = data.items ?? [];
  const comments: YouTubeComment[] = [];
  for (const item of items) {
    const top = item.snippet.topLevelComment;
    comments.push(toComment(top.id, top.snippet, null));
    for (const reply of item.replies?.comments ?? []) {
      comments.push(toComment(reply.id, reply.snippet, reply.snippet.parentId ?? top.id));
    }
  }
  return {
    comments,
    threadCount: items.length,
    nextPageToken: data.nextPageToken ?? null,
  };
}

export const youtubeApi: YouTubeApi = {
  async getVideo(videoId) {
    const data = await callApi<VideosResponse>("videos", { part: "snippet", id: videoId });
    const item = data.items?.[0];
    if (!item) return null;

    const t = item.snippet.thumbnails ?? {};
    // サムネイルは URL だけを保存する（画像は保存しない。要件定義書6章）。
    const thumbnail = t.high ?? t.medium ?? t.default;
    return {
      videoId: item.id,
      title: item.snippet.title,
      thumbnailUrl: thumbnail?.url ?? null,
      publishedAt: item.snippet.publishedAt ?? null,
    };
  },

  async listCommentThreads(videoId, { maxResults, pageToken }) {
    const data = await callApi<CommentThreadsResponse>("commentThreads", {
      part: "snippet,replies",
      videoId,
      maxResults: String(maxResults),
      // 新しい順（初期表示は最新100スレッド。要件定義書7.2）
      order: "time",
      // HTML ではなくプレーンテキストで受け取る（コメントを HTML として扱わない。要件定義書16章）
      textFormat: "plainText",
      ...(pageToken ? { pageToken } : {}),
    });
    return toCommentThreadPage(data);
  },
};
