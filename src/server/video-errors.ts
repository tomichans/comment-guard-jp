import "server-only";

import { GUEST_DAILY_VIDEO_LIMIT } from "@/lib/config/limits";

// =============================================================
// 動画の登録・コメント取得のエラー（要件定義書15.1）【確定】
//
// API Route は、このコードと HTTP ステータス、日本語のメッセージをそのまま返す。
// 画面は message を表示するだけでよい（エラーの種類ごとに文言を持たなくて済む）。
//
// 補足：YouTube API は、APIキーでの問い合わせでは「存在しない動画」と「非公開の動画」を区別せず、
// どちらも「見つからない」と返す。そのため、この2つは1つのエラー（video_not_found）にまとめている。
// =============================================================

export const VIDEO_ERRORS = {
  // 入力のエラー
  invalid_url: {
    status: 400,
    message: "YouTubeの動画URLを入力してください（例：https://www.youtube.com/watch?v=…）",
  },
  // YouTube から返ってきたエラー
  video_not_found: {
    status: 404,
    message: "動画が見つかりません。URLが正しいか、動画が公開されているかを確認してください",
  },
  comments_disabled: {
    status: 422,
    message: "この動画はコメントが無効になっているため、分析できません",
  },
  quota_exceeded: {
    status: 503,
    message: "YouTubeの1日の利用上限に達しました。時間をおいて再度お試しください",
  },
  youtube_error: {
    status: 502,
    message: "YouTubeからの取得に失敗しました。時間をおいて再度お試しください",
  },
  // このアプリの上限（要件定義書3.1）
  guest_video_limit: {
    status: 409,
    message: "ゲストは同時に1本までです。複数の動画を分析するには、無料でアカウント登録してください",
  },
  guest_daily_limit: {
    status: 429,
    message: `ゲストが1日に分析できる動画の数（${GUEST_DAILY_VIDEO_LIMIT}本）に達しました。無料でアカウント登録すると、続けて分析できます`,
  },
} as const;

export type VideoErrorCode = keyof typeof VIDEO_ERRORS;

/** 動画の登録・取得の途中で起きた、画面に伝えるべきエラー。 */
export class VideoError extends Error {
  constructor(public readonly code: VideoErrorCode) {
    super(code);
    this.name = "VideoError";
  }
}
