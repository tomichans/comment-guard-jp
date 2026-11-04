import { describe, expect, it } from "vitest";

import { formatAdviceText } from "@/server/analysis/advice";

// =============================================================
// AIアドバイスの本文の形（要件定義書12章）。DB も AI も使わない。
// =============================================================

describe("アドバイスの本文を作る（formatAdviceText）", () => {
  it("まとまりごとに「■ 見出し」と「・項目」の行にし、空のまとまりは書かない", () => {
    const text = formatAdviceText({
      summary: "まとめ",
      goodPoints: ["手順が分かりやすい", "  "],
      improvements: [],
      gentleSuggestions: ["次は短くしてみるのも一つの方法です"],
      nextVideoIdeas: ["鍋の紹介"],
    });

    expect(text).toBe(
      [
        "■ 評価された点",
        "・手順が分かりやすい",
        "",
        "■ 否定的な意見から",
        "・次は短くしてみるのも一つの方法です",
        "",
        "■ 次の動画のアイデア",
        "・鍋の紹介",
      ].join("\n"),
    );
  });
});
