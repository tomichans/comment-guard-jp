"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import type { Tables } from "@/lib/database.types";

import { InsightsPane } from "./insights-pane";
import { VideoSidebar } from "./video-sidebar";

// =============================================================
// 3つの枠のレイアウト（要件定義書4.1）と、画面全体で共有する情報
//
// 左の動画一覧は、中央で動画を登録したときや、左で削除したときに読み込み直す必要がある。
// そこで、一覧と「読み込み直す関数」を、React の Context で左と中央の両方に渡す。
// =============================================================

export type Video = Tables<"videos">;

/** 今の閲覧者。ゲストには、まだ動画を作っていない初回の訪問者も含む。 */
export type Viewer =
  | { kind: "user"; userId: string; email: string }
  | { kind: "guest" };

type AppState = {
  viewer: Viewer;
  /** 自分の動画の一覧（新しい順）。読み込み中は null。 */
  videos: Video[] | null;
  reloadVideos: () => Promise<void>;
};

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error("useApp() は AppShell の中で使う");
  return state;
}

export function AppShell({ viewer, children }: { viewer: Viewer; children: React.ReactNode }) {
  // key：ログイン・ログアウトで閲覧者が変わったら、前の人の動画一覧を残さず作り直す。
  const key = viewer.kind === "user" ? viewer.userId : "guest";
  return (
    <AppProvider key={key} viewer={viewer}>
      <div className="flex h-screen">
        <aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar">
          <VideoSidebar />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        <aside className="w-80 shrink-0 overflow-y-auto border-l">
          <InsightsPane />
        </aside>
      </div>
    </AppProvider>
  );
}

function AppProvider({ viewer, children }: { viewer: Viewer; children: React.ReactNode }) {
  const [videos, setVideos] = useState<Video[] | null>(null);

  const reloadVideos = useCallback(async () => {
    const response = await fetch("/api/videos", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { videos: Video[] };
    setVideos(body.videos);
  }, []);

  // 画面を開いたときに、一覧を一度読む。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setVideos は通信の後に呼ばれるので、この規則が防ぎたい「描画のたびの即時の更新」にはならない
    reloadVideos();
  }, [reloadVideos]);

  return (
    <AppContext.Provider value={{ viewer, videos, reloadVideos }}>{children}</AppContext.Provider>
  );
}
