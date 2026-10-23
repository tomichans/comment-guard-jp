"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useApp, type Video } from "./app-shell";
import { CommentList } from "./comment-list";
import { formatDate } from "./format";
import { Thumbnail } from "./thumbnail";

/** 残りのコメントを取得中のとき、取得の状況を確かめる間隔（ミリ秒）【確定】 */
const FETCH_STATUS_POLL_MS = 3000;

// 中央の枠の ②分析結果（要件定義書4.3）：動画の情報と、コメント一覧
export function VideoView({ videoId }: { videoId: string }) {
  const { reloadVideos } = useApp();
  const router = useRouter();
  const [video, setVideo] = useState<Video | null>(null);
  // コメント一覧を読み込み直すための番号。増やすと、一覧が最初から読み込み直される。
  const [listVersion, setListVersion] = useState(0);

  // 削除・期限切れの動画は、エラーを出さずに ①URL入力 に戻す（要件定義書3.3）。
  const handleNotFound = useCallback(() => {
    router.replace("/");
    reloadVideos();
  }, [router, reloadVideos]);

  // 開いたときに、動画の情報を読む。
  useEffect(() => {
    let cancelled = false;
    fetchVideo(videoId).then((result) => {
      if (cancelled || result === null) return;
      if (result === "not_found") handleNotFound();
      else setVideo(result);
    });
    return () => {
      cancelled = true;
    };
  }, [videoId, handleNotFound]);

  // 残りのコメントを取得中（fetching）の間は、数秒ごとに状況を確かめる（要件定義書4.3）。
  // 取得が終わったら、増えたコメントを表示するため、一覧を読み込み直す。
  const fetching = video?.fetch_status === "fetching";
  useEffect(() => {
    if (!fetching) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const result = await fetchVideo(videoId);
      if (cancelled || result === null) return;
      if (result === "not_found") return handleNotFound();
      if (result.fetch_status !== "fetching") setListVersion((v) => v + 1);
      setVideo(result);
    }, FETCH_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fetching, videoId, handleNotFound]);

  if (!video) {
    return <p className="p-8 text-sm text-muted-foreground">読み込み中…</p>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex gap-4">
        <Thumbnail url={video.thumbnail_url} className="w-48" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold">{video.title}</h1>
          {video.published_at && (
            <p className="text-sm text-muted-foreground">公開日：{formatDate(video.published_at)}</p>
          )}
          <a
            href={`https://www.youtube.com/watch?v=${video.video_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            YouTubeで開く
          </a>
        </div>
      </header>

      {video.fetch_status === "fetching" && (
        <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
          <Loader2 className="size-4 animate-spin" />
          残りのコメントを取得しています。終わると自動で表示されます。
        </p>
      )}
      {video.fetch_status === "failed" && (
        <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
          <TriangleAlert className="size-4" />
          一部のコメントを取得できませんでした。取得できた分を表示しています。
        </p>
      )}

      <CommentList videoId={video.id} version={listVersion} />
    </div>
  );
}

/** 動画の情報を読む。見つからなければ "not_found"、通信などの失敗は null（次の機会に読み直す）。 */
async function fetchVideo(videoId: string): Promise<Video | "not_found" | null> {
  try {
    const response = await fetch(`/api/videos/${videoId}`, { cache: "no-store" });
    if (response.status === 404) return "not_found";
    if (!response.ok) return null;
    return ((await response.json()) as { video: Video }).video;
  } catch {
    return null;
  }
}
