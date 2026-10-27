import "server-only";

import { ANALYSIS_STALLED_MS } from "@/lib/config/analysis";
import type { Enums, Tables } from "@/lib/database.types";
import { createAdminClient } from "@/server/supabase/admin";

// =============================================================
// 画面に見せる分析の状況
//
// DB の analysis_status は、サーバーの処理が途中で止まる（時間切れなど）と、analyzing のまま残ってしまう。
// そこで、analyzing のまま ANALYSIS_STALLED_MS の間なにも進んでいなければ、failed として扱う。
// こうすると、画面に「分析をやり直す」ボタンが出て、利用者が自分で再開できる。
// =============================================================

export type AnalysisStatus = Enums<"analysis_status">;

export async function effectiveAnalysisStatus(
  video: Pick<Tables<"videos">, "id" | "analysis_status" | "analysis_started_at">,
  now: Date = new Date(),
): Promise<AnalysisStatus> {
  if (video.analysis_status !== "analyzing") return video.analysis_status;

  // 最後に進んだ時刻：分析を始めた（やり直した）時刻と、その動画の API 呼び出し（YouTube・AI）の最新の記録の、遅い方。
  // api_usage_logs はブラウザから読めない表なので、service role で読む（読むのは時刻だけ）。
  const { data, error } = await createAdminClient()
    .from("api_usage_logs")
    .select("created_at")
    .eq("video_id", video.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const lastActivity = Math.max(
    new Date(video.analysis_started_at).getTime(),
    data ? new Date(data.created_at).getTime() : 0,
  );
  return now.getTime() - lastActivity > ANALYSIS_STALLED_MS ? "failed" : "analyzing";
}
