import "server-only";

import { REVIEW_SCORE_THRESHOLD } from "@/lib/config/analysis";
import type { CommentLabel, PrimaryCategory } from "@/lib/comment-categories";
import type { Tables } from "@/lib/database.types";

// =============================================================
// ルールによる判定（要件定義書9.2）
//
// AI を呼ばずに決まる部分だけを、ここにまとめている（DB も API も使わないので、テストしやすい）。
//   1. NGワードの検出（matchNgWords）
//   2. AI と Moderation API の結果を合わせて、最終的な分類を決める（decideAnalysis）
// =============================================================

export type NgWord = Pick<Tables<"ng_words">, "word" | "normalized" | "severity">;

/** severity がこの値の NGワードにヒットしたら、AI を通さずに harmful と確定する（要件定義書9.2） */
export const NG_SEVERITY_HARMFUL = 5;

export type NgMatch = {
  /** ヒットした語（ng_words.word）。comment_analysis.ng_words にそのまま保存する。 */
  words: string[];
  /** ヒットした語のうち、最も高い severity。ヒットなしは 0。 */
  maxSeverity: number;
};

/**
 * 文字の表記ゆれをそろえる。
 * NFKC：全角英数字を半角に、半角カナを全角に、などをそろえる Unicode の標準の変換。
 * 小文字にもそろえる（英字の NGワード用）。
 */
function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * コメント本文に含まれる NGワードを探す。
 * 語そのもの（word）か、正規化表現（normalized。例：「死ね」に対する「しね」）のどちらかが本文に含まれていればヒット。
 * カタカナをひらがなに変えてまでは比べない。「しね」が「シネマ」にヒットするような誤検出を避けるため。
 */
export function matchNgWords(text: string, ngWords: NgWord[]): NgMatch {
  const body = normalize(text);
  const words = new Set<string>();
  let maxSeverity = 0;
  for (const ng of ngWords) {
    const forms = [ng.word, ng.normalized].filter((f): f is string => !!f).map(normalize);
    if (!forms.some((form) => body.includes(form))) continue;
    words.add(ng.word);
    maxSeverity = Math.max(maxSeverity, ng.severity ?? 0);
  }
  return { words: [...words], maxSeverity };
}

/** 分類 AI の結果（1コメント分） */
export type AiClassification = {
  primaryCategory: PrimaryCategory;
  labels: CommentLabel[];
  /** primary_category の確信度（0〜1） */
  score: number;
};

/** Moderation API の結果（1コメント分） */
export type ModerationResult = {
  flagged: boolean;
  /** カテゴリごとの点数のうち、最も高いもの（0〜1） */
  maxScore: number;
};

/** comment_analysis に保存する内容（1コメント分） */
export type AnalysisDecision = {
  primaryCategory: PrimaryCategory;
  labels: CommentLabel[];
  score: number;
  ngWords: string[];
  reviewRequired: boolean;
};

/** AI を通さずに harmful と確定するコメントか（severity=5 の NGワードにヒット） */
export function isHarmfulByNgWord(match: NgMatch): boolean {
  return match.maxSeverity >= NG_SEVERITY_HARMFUL;
}

/**
 * NGワード・分類 AI・Moderation API の結果から、最終的な分類を決める（要件定義書9.2の順序）。
 *   1. severity=5 の NGワードにヒット → harmful（確信度 1.00。AI の結果は使わない）
 *   2. severity 1〜4 のヒットは、AI へのヒントとして使い済み（ここでは分類を変えない）
 *   3. 分類 AI の結果を使う
 *   4. Moderation API が flagged なら、harmful に上書きする
 * severity=5 のときは AI を呼ばないので、ai と moderation は null になる。
 */
export function decideAnalysis(
  match: NgMatch,
  ai: AiClassification | null,
  moderation: ModerationResult | null,
): AnalysisDecision {
  let primaryCategory: PrimaryCategory;
  let labels: CommentLabel[];
  let score: number;

  if (isHarmfulByNgWord(match)) {
    primaryCategory = "harmful";
    labels = [];
    score = 1;
  } else if (!ai) {
    throw new Error("severity=5 の NGワードにヒットしていないコメントには、分類 AI の結果が必要です");
  } else if (moderation?.flagged) {
    primaryCategory = "harmful";
    labels = ai.labels;
    // AI も harmful と判断していれば、高い方の確信度を使う。
    score = ai.primaryCategory === "harmful" ? Math.max(ai.score, moderation.maxScore) : moderation.maxScore;
  } else {
    ({ primaryCategory, labels, score } = ai);
  }
  score = Math.round(Math.min(Math.max(score, 0), 1) * 100) / 100;

  // 人の確認が必要（review_required）にする条件（要件定義書9.2）
  //   - harmful だが、確信度が低い
  //   - severity 1〜4 の NGワードにヒットしたのに、最終的に harmful 以外になった
  const reviewRequired =
    (primaryCategory === "harmful" && score < REVIEW_SCORE_THRESHOLD) ||
    (match.words.length > 0 && primaryCategory !== "harmful");

  return { primaryCategory, labels, score, ngWords: match.words, reviewRequired };
}
