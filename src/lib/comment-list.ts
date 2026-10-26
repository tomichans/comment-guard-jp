// =============================================================
// コメント一覧の並び順と、1回に読み込む件数（要件定義書4.3、17.1）
//
// 画面（並び順の選択肢）とサーバー（API の引数の検証）の両方から使うので、src/lib に置く。
// =============================================================

/** 並び順の選択肢。画面の表示順もこの順。 */
export const COMMENT_SORTS = {
  newest: "新しい順",
  likes: "いいねが多い順",
  replies: "返信が多い順",
} as const;

export type CommentSort = keyof typeof COMMENT_SORTS;

/** 一覧を開いたときの並び順【確定】 */
export const DEFAULT_COMMENT_SORT: CommentSort = "newest";

/** 1回に読み込むスレッド（親コメント）の数。下までスクロールすると、次の分を読み込む【確定】 */
export const COMMENT_PAGE_SIZE = 50;

/** 検索語の最大文字数。長すぎる入力で DB に重い検索をさせないため。 */
export const COMMENT_SEARCH_MAX_LENGTH = 100;

export function isCommentSort(value: unknown): value is CommentSort {
  return typeof value === "string" && Object.hasOwn(COMMENT_SORTS, value);
}
