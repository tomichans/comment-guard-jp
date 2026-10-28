import { describe, expect, it } from "vitest";

import {
  decideAnalysis,
  matchNgWords,
  type AiClassification,
  type NgWord,
} from "@/server/analysis/rules";

// =============================================================
// ルールによる判定（要件定義書9.2）のテスト。DB も AI も使わない。
// =============================================================

const NG_WORDS: NgWord[] = [
  { word: "死ね", normalized: "しね", severity: 5 },
  { word: "殺す", normalized: "ころす", severity: 2 },
  { word: "ゴミ", normalized: "ごみ", severity: 3 },
];

const praise: AiClassification = { primaryCategory: "praise", labels: ["positive"], score: 0.9, topic: null };

describe("matchNgWords：NGワードの検出", () => {
  it("語そのものにヒットする", () => {
    expect(matchNgWords("お前は死ね", NG_WORDS)).toEqual({ words: ["死ね"], maxSeverity: 5 });
  });

  it("正規化表現（ひらがな）にもヒットする", () => {
    expect(matchNgWords("しねよ", NG_WORDS)).toEqual({ words: ["死ね"], maxSeverity: 5 });
  });

  it("カタカナの別の語（シネマ）にはヒットしない", () => {
    expect(matchNgWords("シネマが好き", NG_WORDS)).toEqual({ words: [], maxSeverity: 0 });
  });

  it("半角カナも全角にそろえて比べる", () => {
    expect(matchNgWords("ｺﾞﾐ動画", NG_WORDS).words).toEqual(["ゴミ"]);
  });

  it("複数ヒットしたら、最も高い severity を返す", () => {
    expect(matchNgWords("ゴミ、殺すぞ", NG_WORDS)).toEqual({
      words: ["殺す", "ゴミ"],
      maxSeverity: 3,
    });
  });
});

describe("decideAnalysis：最終的な分類", () => {
  const noHit = { words: [], maxSeverity: 0 };

  it("severity=5 にヒットしたら、AI の結果なしで harmful（確信度1）", () => {
    const d = decideAnalysis({ words: ["死ね"], maxSeverity: 5 }, null, null);
    expect(d).toMatchObject({ primaryCategory: "harmful", score: 1, ngWords: ["死ね"], reviewRequired: false });
  });

  it("ヒットなしなら、AI の分類をそのまま使う", () => {
    const d = decideAnalysis(noHit, praise, { flagged: false, maxScore: 0.01 });
    expect(d).toMatchObject({ primaryCategory: "praise", labels: ["positive"], score: 0.9, reviewRequired: false });
  });

  it("Moderation API が flagged なら、harmful に上書きする", () => {
    const d = decideAnalysis(noHit, praise, { flagged: true, maxScore: 0.95 });
    expect(d).toMatchObject({ primaryCategory: "harmful", score: 0.95, reviewRequired: false });
  });

  it("harmful で確信度が0.7未満なら、人の確認が必要", () => {
    const d = decideAnalysis(noHit, { primaryCategory: "harmful", labels: ["insult"], score: 0.6, topic: null }, null);
    expect(d.reviewRequired).toBe(true);
  });

  it("severity 1〜4 にヒットしたのに harmful 以外になったら、人の確認が必要", () => {
    const d = decideAnalysis({ words: ["殺す"], maxSeverity: 2 }, praise, { flagged: false, maxScore: 0 });
    expect(d).toMatchObject({ primaryCategory: "praise", ngWords: ["殺す"], reviewRequired: true });
  });

  it("確信度は 0〜1 に収め、小数第2位までにする", () => {
    expect(decideAnalysis(noHit, { ...praise, score: 1.234 }, null).score).toBe(1);
    expect(decideAnalysis(noHit, { ...praise, score: 0.876 }, null).score).toBe(0.88);
  });

  it("severity=5 でないのに AI の結果がなければ、エラーにする", () => {
    expect(() => decideAnalysis(noHit, null, null)).toThrow();
  });
});
