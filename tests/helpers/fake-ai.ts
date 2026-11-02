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
//   - 「宣伝」を含む       → spam
//   - 「？」を含む         → question
//   - 「してほしい」を含む → feedback（labels に request）
//   - それ以外             → praise
// Moderation API のルール
//   - 「攻撃」を含む       → flagged（攻撃的と判定された）
// Embedding のルール（グルーピング）
//   - 「音」「字幕」「曲」「機材」のどれかを含むと、その話題ごとに決まったベクトルになる（同じ話題なら類似度 1）
//   - どれも含まなければ、本文ごとに違うベクトルになる（他のコメントとの類似度 0）
// 論点のルール（分類とは別に決める。本物の AI と同じく、分類に関係なく論点を出す）
//   - 「？」を含む         → 質問の論点（questionTopic）＝「論点：」＋本文
//   - 「してほしい」を含む → 指摘・要望の論点（feedbackTopic）＝「論点：」＋本文
//   グルーピングでは、この論点の Embedding を比べる
// =============================================================

/** Embedding の話題。この語を含む本文は、同じベクトルになる（＝同じグループになる）。 */
const EMBEDDING_TOPICS = ["音", "字幕", "曲", "機材"];
const EMBEDDING_DIMENSIONS = 1536;

export type FakeAi = AnalysisAi & {
  /** classify に渡された本文の記録。1回の呼び出しが1つの配列（[[1回目の本文...], [2回目の本文...]]） */
  classified: string[][];
  /** classify に渡された NGワードのヒントの記録（本文 → ヒント） */
  hints: Map<string, string[]>;
  /** classify に渡された動画のタイトルの記録（呼び出しの順） */
  videoTitles: string[];
  /** embed に渡された本文の記録（classified と同じ形） */
  embedded: string[][];
};

function classifyOne(text: string): AiClassification {
  const topics = {
    questionTopic: text.includes("？") ? `論点：${text}` : null,
    feedbackTopic: text.includes("してほしい") ? `論点：${text}` : null,
  };
  if (text.includes("宣伝")) {
    return { primaryCategory: "spam", labels: ["spam"], score: 0.9, ...topics };
  }
  if (text.includes("？")) {
    return { primaryCategory: "question", labels: ["question"], score: 0.9, ...topics };
  }
  if (text.includes("してほしい")) {
    return { primaryCategory: "feedback", labels: ["request"], score: 0.8, ...topics };
  }
  return { primaryCategory: "praise", labels: ["positive"], score: 0.95, ...topics };
}

function moderateOne(text: string): ModerationResult {
  return text.includes("攻撃") ? { flagged: true, maxScore: 0.9 } : { flagged: false, maxScore: 0.01 };
}

/** 1つの次元だけが 1 のベクトル（違う次元のベクトルどうしは、類似度 0 になる）。 */
function embedOne(text: string): number[] {
  const topic = EMBEDDING_TOPICS.findIndex((word) => text.includes(word));
  let dimension = topic;
  if (topic === -1) {
    // 本文から決まる番号（話題の次元とは重ならないようにする）
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) % 1_000_003;
    dimension = EMBEDDING_TOPICS.length + (hash % (EMBEDDING_DIMENSIONS - EMBEDDING_TOPICS.length));
  }
  const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[dimension] = 1;
  return vector;
}

/**
 * 偽物の AI を作る。
 * failOnCall に番号（1から数える）を渡すと、その回の classify でエラーを投げる（AI の障害を再現する）。
 * failEmbedding を true にすると、embed が毎回エラーを投げる。
 */
export function fakeAi(opts: { failOnCall?: number; failEmbedding?: boolean } = {}): FakeAi {
  const classified: string[][] = [];
  const embedded: string[][] = [];
  const hints = new Map<string, string[]>();
  const videoTitles: string[] = [];

  return {
    classified,
    hints,
    videoTitles,
    embedded,

    async classify(inputs: ClassifyInput[], videoTitle: string) {
      classified.push(inputs.map((input) => input.text));
      videoTitles.push(videoTitle);
      if (classified.length === opts.failOnCall) {
        throw new Error("AI の障害（テスト）");
      }
      for (const input of inputs) hints.set(input.text, input.ngHints);
      return inputs.map((input) => classifyOne(input.text));
    },

    async moderate(texts: string[]) {
      return texts.map(moderateOne);
    },

    async embed(texts: string[]) {
      embedded.push(texts);
      if (opts.failEmbedding) throw new Error("Embedding の障害（テスト）");
      return texts.map(embedOne);
    },
  };
}
