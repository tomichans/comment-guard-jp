import type {
  CommentThreadPage,
  YouTubeApi,
  YouTubeComment,
} from "@/server/youtube/client";
import { VideoError, type VideoErrorCode } from "@/server/video-errors";

// =============================================================
// テスト用の偽物の YouTube API
//
// 本物の YouTube に問い合わせると、APIキーとクォータが必要で、結果も毎回変わる。
// そこで、決まった応答を返す偽物を registerVideo() に渡して、取得と保存の流れを確かめる。
// =============================================================

/** 親コメント（スレッド）を1つ作る。replies 件の返信を同梱する。 */
export function thread(id: string, text = `コメント ${id}`, replies = 0): YouTubeComment[] {
  const parent: YouTubeComment = {
    externalId: id,
    parentExternalId: null,
    text,
    author: "投稿者",
    likeCount: 0,
    postedAt: "2026-10-01T00:00:00Z",
    replyCount: replies,
  };
  const children = Array.from({ length: replies }, (_, i) => ({
    ...parent,
    replyCount: null,
    externalId: `${id}.r${i}`,
    parentExternalId: id,
    text: `返信 ${i}`,
  }));
  return [parent, ...children];
}

/** prefix-0 〜 prefix-(n-1) の n スレッドから成る1ページを作る。 */
export function page(prefix: string, n: number, nextPageToken: string | null): CommentThreadPage {
  return {
    comments: Array.from({ length: n }, (_, i) => thread(`${prefix}-${i}`)).flat(),
    threadCount: n,
    nextPageToken,
  };
}

export type FakeYouTube = YouTubeApi & {
  /** listCommentThreads に渡された引数の記録 */
  calls: { maxResults: number; pageToken?: string }[];
};

/**
 * pages を順番に返す偽物。pages の要素に VideoErrorCode を入れると、そのページでエラーを投げる。
 * video に null を渡すと「動画が見つからない」を再現する。
 */
export function fakeYouTube(opts: {
  video?: { title: string } | null;
  pages: (CommentThreadPage | VideoErrorCode)[];
}): FakeYouTube {
  const calls: FakeYouTube["calls"] = [];
  return {
    calls,
    async getVideo(videoId) {
      if (opts.video === null) return null;
      return {
        videoId,
        title: opts.video?.title ?? "テスト動画",
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        publishedAt: "2026-10-01T00:00:00Z",
      };
    },
    async listCommentThreads(_videoId, args) {
      calls.push(args);
      const next = opts.pages[calls.length - 1];
      if (next === undefined) throw new Error("用意したページを超えて取得しようとした");
      if (typeof next === "string") throw new VideoError(next);
      return next;
    },
  };
}
