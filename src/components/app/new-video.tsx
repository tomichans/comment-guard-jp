"use client";

import { Loader2, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GUEST_RETENTION_HOURS, USER_RETENTION_DAYS } from "@/lib/config/retention";

import { useApp, type Video } from "./app-shell";

// 中央の枠の ①URL入力 と ③登録の案内（要件定義書4.3）
export function NewVideo() {
  const { viewer, videos } = useApp();
  // 登録しようとして「ゲストは同時に1本まで」と返ってきたとき（別のタブで登録した場合など）
  const [limitReached, setLimitReached] = useState(false);

  if (viewer.kind === "guest") {
    if (videos === null) return null;
    // ゲストが既に1本持っているときは、URL入力の代わりに登録の案内を出す（要件定義書3.1）。
    if (videos.length > 0 || limitReached) return <GuestLimitPrompt current={videos[0]} />;
  }
  return <UrlForm onGuestLimit={() => setLimitReached(true)} />;
}

function UrlForm({ onGuestLimit }: { onGuestLimit: () => void }) {
  const { viewer, reloadVideos } = useApp();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await response.json()) as
        | { video: Video }
        | { error: string; message: string };

      if ("video" in body) {
        await reloadVideos();
        router.push(`/videos/${body.video.id}`);
        return;
      }
      if (body.error === "guest_video_limit") {
        await reloadVideos();
        onGuestLimit();
        return;
      }
      // エラーの文言はサーバーが決めて返す（src/server/video-errors.ts）。画面はそのまま表示する。
      setError(body.message);
    } catch {
      setError("通信に失敗しました。時間をおいて再度お試しください");
    }
    setPending(false);
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-6 p-8">
      <h1 className="text-center text-2xl font-semibold">分析するYouTube動画のURLを入力してください</h1>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-label="YouTube動画のURL"
          className="h-10"
          required
          disabled={pending}
        />
        <Button type="submit" size="lg" className="h-10 px-4" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "取得中…" : "分析する"}
        </Button>
      </form>
      {pending && (
        <p className="text-center text-sm text-muted-foreground">
          YouTubeから動画とコメントを取得しています…
        </p>
      )}
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
      {/* 保存期間の案内（要件定義書3.1、3.2）。日数は定数から表示する。 */}
      <p className="text-center text-sm text-muted-foreground">
        {viewer.kind === "user"
          ? `分析結果は最長${USER_RETENTION_DAYS}日間保存され、その後自動的に削除されます`
          : `ゲストとして利用中：分析結果は${GUEST_RETENTION_HOURS}時間で自動的に削除されます。アカウント登録すると、複数の動画を最長${USER_RETENTION_DAYS}日間保存できます`}
      </p>
    </div>
  );
}

function GuestLimitPrompt({ current }: { current: Video | undefined }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Lock className="size-5" />
      </div>
      <h1 className="text-xl font-semibold">ゲストは同時に1本までです</h1>
      <p className="text-sm text-muted-foreground">
        複数の動画を保存・分析するには、無料のアカウント登録が必要です。今の動画の分析結果は、登録すると自動的にアカウントへ引き継がれます。
      </p>
      <Button asChild size="lg" className="w-full">
        <Link href="/signup">無料で登録する</Link>
      </Button>
      <Button asChild variant="link">
        <Link href="/login">ログインする</Link>
      </Button>
      {current && (
        <Link
          href={`/videos/${current.id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          今の動画に戻る
        </Link>
      )}
    </div>
  );
}
