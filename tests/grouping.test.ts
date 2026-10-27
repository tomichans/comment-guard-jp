import { describe, expect, it } from "vitest";

import { GROUP_SIMILARITY_THRESHOLD } from "@/lib/config/analysis";
import { assignGroups, cosineSimilarity, groupTypeOf } from "@/server/analysis/grouping";

// =============================================================
// グルーピングの判定（要件定義書10章）。要件定義書0.3で必須のテスト。
//
// DB も AI も使わない。ベクトルは2次元の小さなもので、類似度が分かりやすいように作る。
// 例：[1, 0] と [0.9, 0.1] はほぼ同じ向き（似ている）、[1, 0] と [0, 1] は直角（似ていない）。
// =============================================================

/** 基準 [1, 0] とのコサイン類似度が、ちょうど similarity になる2次元のベクトル */
function vectorWithSimilarity(similarity: number): number[] {
  return [similarity, Math.sqrt(1 - similarity ** 2)];
}

describe("どちらのグループの対象か（groupTypeOf。要件定義書10.1）", () => {
  it.each([
    { category: "question", labels: [], expected: "question" },
    { category: "feedback", labels: [], expected: "feedback_request" },
    { category: "praise", labels: ["request"], expected: "feedback_request" },
    // question は request を含んでいても question（1コメント1グループ。上から順に判定）
    { category: "question", labels: ["request"], expected: "question" },
    // harmful と spam は、request を含んでいても対象外
    { category: "harmful", labels: ["request"], expected: null },
    { category: "spam", labels: ["request"], expected: null },
    { category: "praise", labels: ["positive"], expected: null },
    { category: "negative_opinion", labels: ["negative"], expected: null },
    { category: "other", labels: [], expected: null },
  ] as const)("$category $labels → $expected", ({ category, labels, expected }) => {
    expect(groupTypeOf({ primary_category: category, labels: [...labels] })).toBe(expected);
  });
});

describe("コサイン類似度", () => {
  it("同じ向きは1、直角は0、長さは関係ない", () => {
    expect(cosineSimilarity([1, 0], [3, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], vectorWithSimilarity(0.5))).toBeCloseTo(0.5);
  });
});

describe("グループへの振り分け（assignGroups。要件定義書10.3）", () => {
  const existing = [{ id: "g-sound", groupType: "feedback_request" as const, embedding: [1, 0] }];

  it("類似度が閾値（0.82）以上なら既存のグループに合流し、未満なら新しいグループを作る", () => {
    // 準備：閾値のすぐ上と、すぐ下のコメント
    const candidates = [
      { groupType: "feedback_request" as const, embedding: vectorWithSimilarity(GROUP_SIMILARITY_THRESHOLD + 0.01) },
      { groupType: "feedback_request" as const, embedding: vectorWithSimilarity(GROUP_SIMILARITY_THRESHOLD - 0.01) },
    ];

    // 実行
    const { assignments, newGroups } = assignGroups(candidates, existing);

    // 確認：1件目は既存のグループへ、2件目は新しいグループ（その最初の1件）
    expect(assignments).toEqual([{ groupId: "g-sound" }, { newGroup: 0 }]);
    expect(newGroups).toEqual([{ groupType: "feedback_request", seed: 1 }]);
  });

  it("group_type が違うグループには、どれだけ似ていても合流しない", () => {
    const { assignments, newGroups } = assignGroups(
      [{ groupType: "question", embedding: [1, 0] }],
      existing,
    );
    expect(assignments).toEqual([{ newGroup: 0 }]);
    expect(newGroups).toEqual([{ groupType: "question", seed: 0 }]);
  });

  it("同じ回で新しく作ったグループにも、後ろのコメントが合流する", () => {
    // 準備：既存のグループと直角（似ていない）の、互いに似た2件
    const candidates = [
      { groupType: "feedback_request" as const, embedding: [0, 1] },
      { groupType: "feedback_request" as const, embedding: [0.1, 1] },
    ];

    const { assignments, newGroups } = assignGroups(candidates, existing);

    // 確認：2件とも、1件目が作った新しいグループに入る（グループは1つだけ増える）
    expect(assignments).toEqual([{ newGroup: 0 }, { newGroup: 0 }]);
    expect(newGroups).toHaveLength(1);
  });

  it("閾値を超えるグループが複数あれば、いちばん似ているグループに入る", () => {
    const groups = [
      { id: "g-a", groupType: "question" as const, embedding: vectorWithSimilarity(0.85) },
      { id: "g-b", groupType: "question" as const, embedding: [1, 0] },
    ];
    const { assignments } = assignGroups([{ groupType: "question", embedding: [1, 0] }], groups);
    expect(assignments).toEqual([{ groupId: "g-b" }]);
  });

  it("グループの基準は最初の1件のまま変わらない（合流したコメントで基準がずれない）", () => {
    // 準備：基準 [1, 0] と 0.9 似ている A と、A とは似ているが基準とは 0.82 未満の B
    //   A：基準から約26度、B：基準から約40度（A からは約14度）
    const a = vectorWithSimilarity(0.9);
    const b = vectorWithSimilarity(0.76);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(GROUP_SIMILARITY_THRESHOLD);

    const { assignments } = assignGroups(
      [
        { groupType: "feedback_request", embedding: a },
        { groupType: "feedback_request", embedding: b },
      ],
      existing,
    );

    // 確認：A は合流する。B は基準 [1, 0] と比べるので、合流せずに新しいグループになる
    expect(assignments).toEqual([{ groupId: "g-sound" }, { newGroup: 0 }]);
  });
});
