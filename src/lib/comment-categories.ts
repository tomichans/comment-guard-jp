import type { Enums } from "@/lib/database.types";

// =============================================================
// コメントの分類（要件定義書8章）と、画面のタブ（要件定義書4.3）
//
// 画面（タブ）とサーバー（AI の出力の検証、API の引数の検証）の両方から使うので、src/lib に置く。
// =============================================================

export type PrimaryCategory = Enums<"primary_category">;

/** primary_category（7種）。DB の Enum と同じ値。 */
export const PRIMARY_CATEGORIES = [
  "question",
  "feedback",
  "praise",
  "negative_opinion",
  "harmful",
  "spam",
  "other",
] as const satisfies readonly PrimaryCategory[];

/** labels（11種、複数付与可）。DB では text[] なので、値の検証はアプリ側で行う。 */
export const COMMENT_LABELS = [
  "positive",
  "negative",
  "question",
  "constructive_feedback",
  "request",
  "correction",
  "harassment",
  "insult",
  "threat",
  "spam",
  "off_topic",
] as const;

export type CommentLabel = (typeof COMMENT_LABELS)[number];

/** タブの値。primary_category の6種（other を除く）と、すべて（"all"）。 */
export type CommentTab = Exclude<PrimaryCategory, "other"> | "all";

/**
 * タブの並びと表示名【確定】（要件定義書4.3）。
 * dimmed：誤って選ばれないよう、半透明で表示するタブ。
 * other は専用のタブを持たず、「すべて」の中だけに出る。
 */
export const COMMENT_TABS: { value: CommentTab; label: string; dimmed: boolean }[] = [
  { value: "praise", label: "ポジティブ", dimmed: false },
  { value: "question", label: "質問", dimmed: false },
  { value: "feedback", label: "指摘・要望", dimmed: false },
  { value: "negative_opinion", label: "否定的意見", dimmed: true },
  { value: "spam", label: "スパム", dimmed: true },
  { value: "harmful", label: "要注意・攻撃的", dimmed: true },
  { value: "all", label: "すべて", dimmed: true },
];

/** 分析結果を開いたときに選ばれているタブ【確定】：1番目の「ポジティブ」 */
export const DEFAULT_COMMENT_TAB: CommentTab = "praise";

/** 「すべて」タブを選んだときの警告（要件定義書4.3） */
export const ALL_TAB_WARNING = "誹謗中傷・スパムを含むコメントも表示されます。よろしいですか？";

export function isCommentTab(value: unknown): value is CommentTab {
  return typeof value === "string" && COMMENT_TABS.some((tab) => tab.value === value);
}
