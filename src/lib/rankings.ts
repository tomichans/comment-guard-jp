import type { Enums } from "@/lib/database.types";

// =============================================================
// ランキング（要件定義書4.4、11章）
//
// 画面（右の枠）とサーバー（GET /api/videos/:id/rankings）の両方から使うので、src/lib に置く。
// =============================================================

export type RankingItem = {
  /** 順位（1から。同率は出さない） */
  rank: number;
  /** グループの代表論点（例：「音声・ナレーションが聞き取りづらい」） */
  text: string;
  /** グループに入っているコメントの数 */
  count: number;
};

/** GET /api/videos/:id/rankings の応答 */
export type VideoRankings = {
  /** 分析の状況。analyzing の間は、画面が数秒ごとに読み直す */
  status: Enums<"analysis_status">;
  feedbackRequest: RankingItem[];
  question: RankingItem[];
};
