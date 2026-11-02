import type { Enums } from "@/lib/database.types";

// =============================================================
// AIアドバイス（要件定義書4.4、12章）
//
// 画面（右の枠）とサーバー（GET /api/videos/:id/advice）の両方から使うので、src/lib に置く。
// =============================================================

/**
 * アドバイスの状態
 *   - waiting：分析中（分析が終わったら作る）
 *   - ready：できている（advice に中身がある）
 *   - failed：分析かアドバイスづくりに失敗した（中央の枠の「分析をやり直す」で作り直せる）
 *   - too_few：分析が済んだコメントが少ないため、作らなかった
 *   - unavailable：分析は終わったが、アドバイスがない（スライス5より前に分析した動画など）
 */
export type AdviceState = "waiting" | "ready" | "failed" | "too_few" | "unavailable";

/** GET /api/videos/:id/advice の応答 */
export type VideoAdvice = {
  /** 分析の状況。analyzing の間は、画面が数秒ごとに読み直す */
  status: Enums<"analysis_status">;
  state: AdviceState;
  advice: {
    /** 全体のまとめ（1〜2文） */
    summary: string;
    /** 本文（「■ 見出し」と「・項目」の行からなる文章。src/server/analysis/advice.ts の formatAdviceText） */
    text: string;
    generatedAt: string;
  } | null;
};
