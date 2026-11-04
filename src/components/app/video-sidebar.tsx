"use client";

import { FileText, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useApp, type Video } from "./app-shell";
import { Thumbnail } from "./thumbnail";

// 左の枠（要件定義書4.2）：「＋新しい動画」、動画一覧、ログイン状態
// ChatGPT のように折りたためる。閉じているときは、開くボタンと「＋新しい動画」だけの細い帯にする。
export function VideoSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { viewer, videos } = useApp();

  if (collapsed) {
    return (
      <div className="flex flex-1 flex-col items-center gap-2 py-3">
        <Button variant="ghost" size="icon" onClick={onToggle} aria-label="動画一覧を開く" title="動画一覧を開く">
          <PanelLeftOpen />
        </Button>
        <Button asChild variant="ghost" size="icon">
          <Link href="/" aria-label="新しい動画" title="新しい動画">
            <Plus />
          </Link>
        </Button>
        {/* 閉じていても、利用規約・プライバシーポリシーをいつでも開けるようにする（要件定義書18.3） */}
        <Button asChild variant="ghost" size="icon" className="mt-auto">
          <Link href="/terms" aria-label="利用規約・プライバシーポリシー" title="利用規約・プライバシーポリシー">
            <FileText />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="truncate px-1 text-lg font-semibold">
            CommentGuard JP
          </Link>
          <Button variant="ghost" size="icon" onClick={onToggle} aria-label="動画一覧を閉じる" title="動画一覧を閉じる">
            <PanelLeftClose />
          </Button>
        </div>
        <Button asChild variant="outline" className="justify-start">
          <Link href="/">
            <Plus />
            新しい動画
          </Link>
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3" aria-label="動画一覧">
        <p className="px-1 pb-2 text-xs text-muted-foreground">動画一覧</p>
        {videos === null ? (
          <p className="px-1 text-sm text-muted-foreground">読み込み中…</p>
        ) : videos.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">まだ動画はありません</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {videos.map((video) => (
              <VideoItem key={video.id} video={video} canDelete={viewer.kind === "user"} />
            ))}
          </ul>
        )}
      </nav>

      <div className="border-t p-3">
        {viewer.kind === "user" ? (
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm" title={viewer.email}>
              {viewer.email}
            </p>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                ログアウト
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link href="/signup">無料で登録する</Link>
            </Button>
            <Button asChild variant="link" size="sm">
              <Link href="/login">ログインする</Link>
            </Button>
          </div>
        )}
        <LegalLinks />
      </div>
    </>
  );
}

/** 利用規約・プライバシーポリシーへのリンク（要件定義書18.3。左の枠の下に、いつも出す） */
function LegalLinks() {
  return (
    <nav className="mt-3 flex justify-center gap-4 text-xs text-muted-foreground" aria-label="規約">
      <Link href="/terms" className="underline-offset-4 hover:underline">
        利用規約
      </Link>
      <Link href="/privacy" className="underline-offset-4 hover:underline">
        プライバシーポリシー
      </Link>
    </nav>
  );
}

function VideoItem({ video, canDelete }: { video: Video; canDelete: boolean }) {
  const { reloadVideos } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const href = `/videos/${video.id}`;
  const active = pathname === href;

  // ログインユーザーだけが削除できる（要件定義書18.2。ゲストには削除ボタンを出さない）。
  async function handleDelete() {
    if (!window.confirm(`「${video.title}」を削除しますか？\nコメントと分析結果も削除されます（YouTube上のデータには影響しません）。`)) {
      return;
    }
    setDeleting(true);
    const response = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
    // 404（すでに消えていた）も、一覧から消えればよいので、エラーにはしない。
    if (!response.ok && response.status !== 404) {
      setDeleting(false);
      window.alert("削除できませんでした。時間をおいて再度お試しください");
      return;
    }
    if (active) router.push("/");
    await reloadVideos();
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-1 rounded-lg hover:bg-sidebar-accent",
        active && "bg-sidebar-accent",
        deleting && "opacity-50",
      )}
    >
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 p-1.5">
        <Thumbnail url={video.thumbnail_url} className="w-20" />
        <span className="line-clamp-2 text-sm">{video.title}</span>
      </Link>
      {canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={handleDelete}
          disabled={deleting}
          aria-label={`「${video.title}」を削除`}
        >
          <Trash2 />
        </Button>
      )}
    </li>
  );
}
