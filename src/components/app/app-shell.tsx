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

// 左の枠を閉じているかを、ブラウザに覚えさせるときの名前。
const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

export function AppShell({ viewer, children }: { viewer: Viewer; children: React.ReactNode }) {
  // key：ログイン・ログアウトで閲覧者が変わったら、前の人の動画一覧を残さず作り直す。
  const key = viewer.kind === "user" ? viewer.userId : "guest";
  const [collapsed, setCollapsed] = useSidebarCollapsed();

  // 幅の決め方（要件定義書4.1）：
  // - 左：開いているときは 18rem（288px）、閉じているときは 3.5rem（56px）の細い帯。
  // - 右：画面の幅から、左と、中央の本文の最大幅（48rem = 768px。余白を含む）を引いた残り。
  //   ただし 20rem（320px）より狭くせず、40rem（640px）より広くしない（1行が長すぎると読みにくいため）。
  // - 中央：その残り。本文は最大768pxで、それより広いときは左右の余白になる。
  const sidebarWidth = collapsed ? "3.5rem" : "18rem";
  const insightsWidth = `clamp(20rem, calc(100vw - ${sidebarWidth} - 48rem), 40rem)`;

  return (
    <AppProvider key={key} viewer={viewer}>
      <div className="flex h-screen">
        <aside
          className="flex shrink-0 flex-col border-r bg-sidebar"
          style={{ width: sidebarWidth }}
        >
          <VideoSidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        <aside className="shrink-0 overflow-y-auto border-l" style={{ width: insightsWidth }}>
          <InsightsPane />
        </aside>
      </div>
    </AppProvider>
  );
}

/**
 * 左の枠を閉じているか。再読み込みしても同じ状態になるよう、ブラウザ（localStorage）に覚えさせる。
 * サーバーではブラウザの記録を読めないので、最初は「開いている」で描画し、画面を開いた後に記録を読む。
 * 記録を読めない環境（プライベートウィンドウなど）では、いつも「開いている」から始める。
 */
function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- サーバーでは読めない記録を、画面を開いた後に1回だけ反映する
      if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setCollapsedState(true);
    } catch {
      // 読めなければ、開いたまま
    }
  }, []);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0");
    } catch {
      // 覚えられなくても、今の画面では切り替わる
    }
  }, []);

  return [collapsed, setCollapsed];
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
