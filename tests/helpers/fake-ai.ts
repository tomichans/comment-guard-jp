import type { AnalysisAi, ClassifyInput } from "@/server/analysis/ai";
import type { AiClassification, ModerationResult } from "@/server/analysis/rules";

// =============================================================
// テスト用の偽物の AI（分類と Moderation API）
//
// 本物の OpenAI に問い合わせると、APIキーと費用が必要で、結果も毎回変わる。
// そこで、本文に決まった文字が入っているかどうかだけで結果を決める偽物を使う。
// 分析の本体（analyzeVideoComments）は、本物か偽物かを気にせず ai.classify() / ai.moderate() を呼ぶ。
//
// 分類のルール（上から順に見て、最初に当てはまったもの）
//   - 「？」を含む         → question
//   - 「してほしい」を含む → feedback（labels に request）
//   - それ以外             → praise
// Moderation API のルール
//   - 「攻撃」を含む       → flagged（攻撃的と判定された）
// =============================================================

export type FakeAi = AnalysisAi & {
  /** classify に渡された本文の記録。1回の呼び出しが1つの配列（[[1回目の本文...], [2回目の本文...]]） */
  classified: string[][];
  /** classify に渡された NGワードのヒントの記録（本文 → ヒント） */
  hints: Map<string, string[]>;
};

function classifyOne(text: string): AiClassification {
  if (text.includes("？")) {
    return { primaryCategory: "question", labels: ["question"], score: 0.9 };
  }
  if (text.includes("してほしい")) {
    return { primaryCategory: "feedback", labels: ["request"], score: 0.8 };
  }
  return { primaryCategory: "praise", labels: ["positive"], score: 0.95 };
}

function moderateOne(text: string): ModerationResult {
  return text.includes("攻撃") ? { flagged: true, maxScore: 0.9 } : { flagged: false, maxScore: 0.01 };
}

/**
 * 偽物の AI を作る。
 * failOnCall に番号（1から数える）を渡すと、その回の classify でエラーを投げる（AI の障害を再現する）。
 */
export function fakeAi(opts: { failOnCall?: number } = {}): FakeAi {
  const classified: string[][] = [];
  const hints = new Map<string, string[]>();

  return {
    classified,
    hints,

    async classify(inputs: ClassifyInput[]) {
      classified.push(inputs.map((input) => input.text));
      if (classified.length === opts.failOnCall) {
        throw new Error("AI の障害（テスト）");
      }
      for (const input of inputs) hints.set(input.text, input.ngHints);
      return inputs.map((input) => classifyOne(input.text));
    },

    async moderate(texts: string[]) {
      return texts.map(moderateOne);
    },
  };
}
