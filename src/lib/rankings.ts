import type { Enums } from "@/lib/database.types";

// =============================================================
// ランキング（要件定義書4.4、11章）
//
// 画面（右の枠）とサーバー（GET /api/videos/:id/rankings）の両方から使うので、src/lib に置く。
// =============================================================

export type RankingItem = {
  /** グループの id。ランキングを選ぶと、このグループのコメントの一覧を出す（GET /api/videos/:id/comments の group） */
  id: string;
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

/**
 * ランキングの項目を選んだときの、コメント一覧のタブ【確定】（要件定義書4.4）。
 * グループには要注意（harmful）のコメントも入る（要件定義書10.1）ので、おだやかなコメントと分けて見せる。
 * dimmed：誤って選ばれないよう、半透明で表示するタブ（中央の枠の分類のタブと同じ考え方）。
 */
export const GROUP_COMMENT_TABS = [
  { value: "calm", label: "おだやか", dimmed: false },
  { value: "harmful", label: "要注意", dimmed: true },
] as const;

export type GroupCommentTab = (typeof GROUP_COMMENT_TABS)[number]["value"];

/** ランキングの項目を選んだときに、選ばれているタブ【確定】 */
export const DEFAULT_GROUP_COMMENT_TAB: GroupCommentTab = "calm";

export function isGroupCommentTab(value: unknown): value is GroupCommentTab {
  return GROUP_COMMENT_TABS.some((tab) => tab.value === value);
}
