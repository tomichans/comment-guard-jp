import { writeFile } from "node:fs/promises";

import { expect, it } from "vitest";

import { PRIMARY_CATEGORIES, type PrimaryCategory } from "@/lib/comment-categories";
import { CLASSIFY_BATCH_SIZE } from "@/lib/config/analysis";
import { openAiAnalysis } from "@/server/analysis/ai";
import { decideAnalysis, isHarmfulByNgWord, matchNgWords } from "@/server/analysis/rules";
import { serverEnv } from "@/server/env";
import { createAdminClient } from "@/server/supabase/admin";
import type { UsageContext } from "@/server/usage";

import dataset from "./classification-dataset.json";
import { computeMetrics, renderReport, type EvalItem } from "./metrics";

// =============================================================
// コメント分類の評価（スライス6）：npm run eval
//
// 架空のコメント100件（eval/classification-dataset.json）を、本番と同じ方法で分類し、
// 人が付けた正解と比べて、結果を docs/evaluation.md に書き出す。
//
// - 本物の OpenAI を呼ぶので、.env.local の OPENAI_API_KEY が要る（費用は1回あたり数円の見込み）。
// - NGワードは、ローカルの Supabase の ng_words（seed.sql）を使う。使用量も api_usage_logs に記録される。
// - 判定の組み合わせ（NGワード → 分類の AI → Moderation API）は、本番の analyzeBatch（src/server/analysis/analyze.ts）と同じ。
//   DB に分析結果は保存しない。
// - AI の結果は毎回少し変わるので、npm test（自動テスト）には入れていない。
//
// Vitest を「TypeScript を実行する道具」として使っている（@/ の読み込みや .env.local の読み込みを、テストと同じ設定で使えるため。
// 設定は vitest.config.mts の mode === "eval"）。
// =============================================================

type DatasetComment = { id: string; text: string; expected: string; note?: string };

function isPrimaryCategory(value: string): value is PrimaryCategory {
  return (PRIMARY_CATEGORIES as readonly string[]).includes(value);
}

it("コメントの分類を評価して、docs/evaluation.md に書き出す", async () => {
  const started = Date.now();
  const comments = dataset.comments as DatasetComment[];
  for (const c of comments) {
    if (!isPrimaryCategory(c.expected)) throw new Error(`${c.id} の正解「${c.expected}」は、分類の値ではありません`);
  }

  const admin = createAdminClient();
  const { data: ngWords, error } = await admin.from("ng_words").select("word, normalized, severity");
  if (error) throw error;

  // 使用量の記録（api_usage_logs）を、この実行の分だけ数えられるよう、実行ごとに別の id にする。
  const ctx: UsageContext = { videoId: crypto.randomUUID(), userId: null, guestId: null, ipHash: null };

  const items: EvalItem[] = [];
  // 本番と同じく、50件ずつまとめて送る。
  for (let start = 0; start < comments.length; start += CLASSIFY_BATCH_SIZE) {
    const batch = comments.slice(start, start + CLASSIFY_BATCH_SIZE);
    const matches = batch.map((c) => matchNgWords(c.text, ngWords));
    const toAi = batch.flatMap((_, i) => (isHarmfulByNgWord(matches[i]) ? [] : [i]));

    const [classifications, moderations] = await Promise.all([
      openAiAnalysis.classify(
        toAi.map((i) => ({ text: batch[i].text, ngHints: matches[i].words })),
        dataset.video_title,
        ctx,
      ),
      openAiAnalysis.moderate(
        toAi.map((i) => batch[i].text),
        ctx,
      ),
    ]);
    const position = new Map(toAi.map((i, p) => [i, p]));

    batch.forEach((c, i) => {
      const p = position.get(i);
      const decision = decideAnalysis(
        matches[i],
        p === undefined ? null : classifications[p],
        p === undefined ? null : moderations[p],
      );
      items.push({
        id: c.id,
        text: c.text,
        expected: c.expected as PrimaryCategory,
        predicted: decision.primaryCategory,
        note: c.note,
      });
    });
  }

  const metrics = computeMetrics(items);

  // この実行で使った推定費用の合計（料金表にないモデルが混ざっていれば null）
  const usage = await admin
    .from("api_usage_logs")
    .select("estimated_cost_usd")
    .eq("video_id", ctx.videoId);
  if (usage.error) throw usage.error;
  const costs = usage.data.map((r) => r.estimated_cost_usd);
  const costUsd = costs.some((c) => c === null)
    ? null
    : costs.reduce<number>((sum, c) => sum + Number(c), 0);

  const report = renderReport(metrics, {
    date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    classifyModel: serverEnv.openaiClassifyModel,
    videoTitle: dataset.video_title,
    costUsd,
    durationSeconds: (Date.now() - started) / 1000,
  });
  await writeFile(new URL("../docs/evaluation.md", import.meta.url), report);

  console.info(
    `[eval] 正解率 ${(metrics.accuracy * 100).toFixed(1)}%、要注意の見逃し ${metrics.harmfulMissed.length}件。docs/evaluation.md に書き出しました`,
  );
  expect(items).toHaveLength(comments.length);
});
