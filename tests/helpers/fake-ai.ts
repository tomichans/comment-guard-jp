import type { AnalysisAi, ClassifyInput } from "@/server/analysis/ai";
import type { AiClassification, ModerationResult } from "@/server/analysis/rules";

// =============================================================
// テスト用の偽物の AI（分類と Moderation API）
//
// 本物の OpenAI に問い合わせると、APIキーと費用が必要で、結果も毎回変わる。
// そこで、本文の中の決まった文字で結果を決める偽物を analyzeVideoComments() に渡して、流れを確かめる。
//   - 「？」を含む       → question
//   - 「してほしい」を含む → feedback（labels に request）
//   - 「攻撃」を含む     → Moderation API が flagged
//   - それ以外           → praise
// =============================================================

export type FakeAi = AnalysisAi & {
  /** classify に渡された本文（呼び出しごと） */
  classified: string[][];
  /** classify に渡された NGワードのヒント（本文 → ヒント） */
  hints: Map<string, string[]>;
};

/** failOnCall に番号（1から）を渡すと、その回の classify でエラーを投げる（AI の障害を再現する）。 */
export function fakeAi(opts: { failOnCall?: number } = {}): FakeAi {
  const classified: string[][] = [];
  const hints = new Map<string, string[]>();
  return {
    classified,
    hints,
    async classify(inputs: ClassifyInput[]): Promise<AiClassification[]> {
      classified.push(inputs.map((i) => i.text));
      if (classified.length === opts.failOnCall) throw new Error("AI の障害（テスト）");
      return inputs.map((input) => {
        hints.set(input.text, input.ngHints);
        if (input.text.includes("？")) return { primaryCategory: "question", labels: ["question"], score: 0.9 };
        if (input.text.includes("してほしい")) {
          return { primaryCategory: "feedback", labels: ["request"], score: 0.8 };
        }
        return { primaryCategory: "praise", labels: ["positive"], score: 0.95 };
      });
    },
    async moderate(texts: string[]): Promise<ModerationResult[]> {
      return texts.map((text) =>
        text.includes("攻撃") ? { flagged: true, maxScore: 0.9 } : { flagged: false, maxScore: 0.01 },
      );
    },
  };
}
