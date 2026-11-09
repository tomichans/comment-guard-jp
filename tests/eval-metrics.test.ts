import { describe, expect, it } from "vitest";

import { computeMetrics, renderReport, type EvalItem } from "../eval/metrics";

// =============================================================
// 分類の評価の集計（eval/metrics.ts）
// AI も DB も使わない計算だけを確かめる。
// =============================================================

function item(id: string, expected: EvalItem["expected"], predicted: EvalItem["predicted"]): EvalItem {
  return { id, text: `コメント${id}`, expected, predicted };
}

const items: EvalItem[] = [
  item("1", "harmful", "harmful"),
  item("2", "harmful", "negative_opinion"), // 見逃し
  item("3", "praise", "praise"),
  item("4", "praise", "harmful"), // 誤って要注意
  item("5", "question", "question"),
  item("6", "other", "question"),
];

describe("分類の評価の集計", () => {
  const metrics = computeMetrics(items);

  it("正解率を数える", () => {
    expect(metrics.total).toBe(6);
    expect(metrics.correct).toBe(3);
    expect(metrics.accuracy).toBeCloseTo(0.5);
  });

  it("要注意の見逃しと、誤って要注意にしたものを分けて数える", () => {
    expect(metrics.harmfulMissed.map((i) => i.id)).toEqual(["2"]);
    expect(metrics.harmfulMissRate).toBeCloseTo(0.5);
    expect(metrics.falseHarmful.map((i) => i.id)).toEqual(["4"]);
    expect(metrics.falseHarmfulRate).toBeCloseTo(0.25);
  });

  it("分類ごとの再現率と適合率を出す（0件の分類は null）", () => {
    const question = metrics.categories.find((c) => c.category === "question")!;
    expect(question).toMatchObject({ expected: 1, predicted: 2, correct: 1, recall: 1, precision: 0.5 });
    const spam = metrics.categories.find((c) => c.category === "spam")!;
    expect(spam).toMatchObject({ expected: 0, predicted: 0, recall: null, precision: null });
  });

  it("混同行列を、正解と AI の分類の組で数える", () => {
    expect(metrics.confusion.harmful.negative_opinion).toBe(1);
    expect(metrics.confusion.other.question).toBe(1);
    expect(metrics.confusion.praise.praise).toBe(1);
  });

  it("結果の文書に、正解率と、正解と違ったコメントが載る", () => {
    const report = renderReport(metrics, {
      date: "2026-11-06",
      classifyModel: "test-model",
      videoTitle: "テスト動画",
      costUsd: null,
      durationSeconds: 1,
    });
    expect(report).toContain("50.0%");
    expect(report).toContain("コメント2");
    expect(report).not.toContain("| 3 | コメント3");
  });
});
