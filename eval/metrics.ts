import { PRIMARY_CATEGORIES, type PrimaryCategory } from "@/lib/comment-categories";

// =============================================================
// 分類の評価の集計（スライス6）
//
// AI の分類結果と、人が付けた正解を比べて、数字にする。
// AI も DB も使わない計算だけなので、tests/eval-metrics.test.ts で確かめている。
// =============================================================

/** 画面と同じ日本語の名前（other は「その他」） */
export const CATEGORY_NAMES: Record<PrimaryCategory, string> = {
  praise: "ポジティブ",
  question: "質問",
  feedback: "指摘・要望",
  negative_opinion: "否定的意見",
  spam: "スパム",
  harmful: "要注意",
  other: "その他",
};

/** 表に並べる順番（画面のタブの順。その他は最後） */
export const CATEGORY_ORDER: PrimaryCategory[] = [
  "praise",
  "question",
  "feedback",
  "negative_opinion",
  "spam",
  "harmful",
  "other",
];

export type EvalItem = {
  id: string;
  text: string;
  expected: PrimaryCategory;
  predicted: PrimaryCategory;
  note?: string;
};

export type CategoryMetrics = {
  category: PrimaryCategory;
  /** 正解がこの分類のコメントの数 */
  expected: number;
  /** AI がこの分類にしたコメントの数 */
  predicted: number;
  /** 正解がこの分類で、AI もこの分類にした数 */
  correct: number;
  /** 再現率：正解がこの分類のもののうち、AI も当てた割合（見逃しの少なさ）。0件なら null */
  recall: number | null;
  /** 適合率：AI がこの分類にしたもののうち、正しかった割合（誤りの少なさ）。0件なら null */
  precision: number | null;
};

export type EvalMetrics = {
  total: number;
  correct: number;
  accuracy: number;
  categories: CategoryMetrics[];
  /** confusion[正解][AIの分類] = 件数 */
  confusion: Record<PrimaryCategory, Record<PrimaryCategory, number>>;
  /** 要注意のコメントを、要注意以外にしてしまったもの（見逃し） */
  harmfulMissed: EvalItem[];
  /** 見逃しの割合（要注意のコメントのうち） */
  harmfulMissRate: number | null;
  /** 要注意ではないコメントを、要注意にしてしまったもの（このアプリでは、見逃しより許す方針） */
  falseHarmful: EvalItem[];
  /** 誤って要注意にした割合（要注意ではないコメントのうち） */
  falseHarmfulRate: number | null;
  /** 正解と違ったもの（すべて） */
  mistakes: EvalItem[];
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function computeMetrics(items: EvalItem[]): EvalMetrics {
  const confusion = Object.fromEntries(
    PRIMARY_CATEGORIES.map((e) => [e, Object.fromEntries(PRIMARY_CATEGORIES.map((p) => [p, 0]))]),
  ) as EvalMetrics["confusion"];
  for (const item of items) confusion[item.expected][item.predicted]++;

  const categories = CATEGORY_ORDER.map((category): CategoryMetrics => {
    const expected = items.filter((i) => i.expected === category).length;
    const predicted = items.filter((i) => i.predicted === category).length;
    const correct = confusion[category][category];
    return {
      category,
      expected,
      predicted,
      correct,
      recall: ratio(correct, expected),
      precision: ratio(correct, predicted),
    };
  });

  const mistakes = items.filter((i) => i.expected !== i.predicted);
  const harmful = items.filter((i) => i.expected === "harmful");
  const notHarmful = items.filter((i) => i.expected !== "harmful");
  const harmfulMissed = harmful.filter((i) => i.predicted !== "harmful");
  const falseHarmful = notHarmful.filter((i) => i.predicted === "harmful");

  return {
    total: items.length,
    correct: items.length - mistakes.length,
    accuracy: ratio(items.length - mistakes.length, items.length) ?? 0,
    categories,
    confusion,
    harmfulMissed,
    harmfulMissRate: ratio(harmfulMissed.length, harmful.length),
    falseHarmful,
    falseHarmfulRate: ratio(falseHarmful.length, notHarmful.length),
    mistakes,
  };
}

// -------------------------------------------------------------
// 結果の文書（docs/evaluation.md）
// -------------------------------------------------------------

export type ReportMeta = {
  /** 実行した日（例：2026-11-06） */
  date: string;
  classifyModel: string;
  videoTitle: string;
  /** 推定費用（米ドル）。料金表にないモデルなら null */
  costUsd: number | null;
  durationSeconds: number;
};

function percent(value: number | null): string {
  return value === null ? "－" : `${(value * 100).toFixed(1)}%`;
}

/** 表の中で、| や改行が表を崩さないようにする */
function cell(text: string): string {
  return text.replace(/\|/g, "｜").replace(/\s*\n\s*/g, " ");
}

export function renderReport(metrics: EvalMetrics, meta: ReportMeta): string {
  const name = (c: PrimaryCategory) => CATEGORY_NAMES[c];
  const lines: string[] = [];

  lines.push(
    "# コメント分類の評価",
    "",
    "このファイルは `npm run eval` が作る（手で書き換えない）。評価の方法は README の「分類の評価」を参照。",
    "",
    `- 実行日：${meta.date}`,
    `- 分類のモデル：\`${meta.classifyModel}\`（NGワード、Moderation API と組み合わせた、本番と同じ判定）`,
    `- 評価用のコメント：${metrics.total}件（架空。\`eval/classification-dataset.json\`）、動画のタイトル「${meta.videoTitle}」`,
    `- かかった時間：${meta.durationSeconds.toFixed(0)}秒、推定費用：${meta.costUsd === null ? "料金表にないモデルのため不明" : `$${meta.costUsd.toFixed(4)}`}`,
    "",
    "## まとめ",
    "",
    "| 指標 | 値 | 意味 |",
    "| --- | --- | --- |",
    `| 正解率 | **${percent(metrics.accuracy)}**（${metrics.correct}／${metrics.total}件） | 7種の分類が、正解と一致した割合 |`,
    `| 要注意の見逃し | **${percent(metrics.harmfulMissRate)}**（${metrics.harmfulMissed.length}件） | 要注意のコメントを、他の分類にしてしまった割合。低いほどよい |`,
    `| 誤って要注意 | ${percent(metrics.falseHarmfulRate)}（${metrics.falseHarmful.length}件） | 要注意ではないコメントを、要注意にしてしまった割合 |`,
    "",
    "このアプリは、コメントで心を痛めやすい発信者を守るためのものなので、**要注意の見逃しを最も重く見る**。",
    "誤って要注意にした場合は、そのコメントが「要注意」のタブに入るだけで、発信者が傷つくことはないため、ある程度は許す（要件定義書9.1）。",
    "",
    "## 分類ごとの結果",
    "",
    "| 分類 | 正解の件数 | AIの件数 | 一致 | 再現率（見逃しの少なさ） | 適合率（誤りの少なさ） |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const c of metrics.categories) {
    lines.push(
      `| ${name(c.category)} | ${c.expected} | ${c.predicted} | ${c.correct} | ${percent(c.recall)} | ${percent(c.precision)} |`,
    );
  }

  lines.push(
    "",
    "## 混同行列",
    "",
    "行が正解、列が AI の分類。対角線（同じ分類どうし）が一致した数。",
    "",
    `| 正解＼AI | ${CATEGORY_ORDER.map(name).join(" | ")} |`,
    `| --- | ${CATEGORY_ORDER.map(() => "---").join(" | ")} |`,
  );
  for (const e of CATEGORY_ORDER) {
    const row = CATEGORY_ORDER.map((p) => {
      const n = metrics.confusion[e][p];
      return e === p ? `**${n}**` : n === 0 ? "・" : String(n);
    });
    lines.push(`| ${name(e)} | ${row.join(" | ")} |`);
  }

  lines.push("", "## 正解と違ったコメント", "");
  if (metrics.mistakes.length === 0) {
    lines.push("なし。");
  } else {
    lines.push("| ID | コメント | 正解 | AI | 補足 |", "| --- | --- | --- | --- | --- |");
    for (const m of metrics.mistakes) {
      lines.push(
        `| ${m.id} | ${cell(m.text)} | ${name(m.expected)} | ${name(m.predicted)} | ${cell(m.note ?? "")} |`,
      );
    }
  }

  return lines.join("\n") + "\n";
}
