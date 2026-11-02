import { afterAll, describe, expect, it } from "vitest";

import { ADVICE_MIN_ANALYZED_COMMENTS } from "@/lib/config/analysis";
import { getAdviceOfOwnedVideo, type Owner } from "@/server/access";
import { analyzeVideoComments, retryAnalysis } from "@/server/analysis/analyze";

import { fakeAi } from "./helpers/fake-ai";
import { admin, cleanup, insertVideo, newGuestId } from "./helpers/db";

// =============================================================
// AIアドバイス（要件定義書12章。スライス5）
//
// AI は偽物（tests/helpers/fake-ai.ts）を使う。アドバイスは決まった文を返し、渡されたデータを記録する。
// 偽物の分類：「？」→ question、「してほしい」→ feedback、「宣伝」→ spam、それ以外 → praise。
//           Moderation：「攻撃」→ harmful。
// =============================================================

/** ゲストの動画を1本作り、texts の本文の親コメントを保存する。いいねは、後ろのコメントほど多い。 */
async function createGuestVideo(texts: string[]) {
  const guestId = newGuestId();
  const owner: Owner = { kind: "guest", guestId };
  const video = await insertVideo({ guestId });
  const { error } = await admin.from("comments").insert(
    texts.map((text, i) => ({
      video_id: video.id,
      external_comment_id: `c-${i}-${crypto.randomUUID()}`,
      comment_text: text,
      like_count: i,
      posted_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    })),
  );
  if (error) throw error;
  return { owner, video };
}

async function adviceRows(videoId: string) {
  const { data, error } = await admin.from("advice_logs").select("*").eq("video_id", videoId);
  if (error) throw error;
  return data;
}

async function analysisStatusOf(videoId: string) {
  const { data, error } = await admin.from("videos").select("analysis_status").eq("id", videoId).single();
  if (error) throw error;
  return data.analysis_status;
}

/** アドバイスが作られる数のコメント（ポジティブ、要望、質問、要注意、スパムを含む） */
const ENOUGH_COMMENTS = [
  "最高でした",
  "分かりやすかったです",
  "また見たいです",
  "音を大きくしてほしい",
  "音量を上げてほしい",
  "どこの鍋ですか？",
  "攻撃的なひどいコメント",
  "宣伝です、私のチャンネルへ",
  "楽しかった",
  "ありがとうございます",
  "勉強になりました",
];

describe("AIアドバイスを作る（要件定義書12章）", () => {
  afterAll(cleanup);

  it("分析がすべて終わったら、アドバイスを1回だけ作って保存し、done にする", async () => {
    expect(ENOUGH_COMMENTS.length).toBeGreaterThanOrEqual(ADVICE_MIN_ANALYZED_COMMENTS);
    const { owner, video } = await createGuestVideo(ENOUGH_COMMENTS);
    const ai = fakeAi();

    await analyzeVideoComments(video, { ai });

    expect(await analysisStatusOf(video.id)).toBe("done");
    const rows = await adviceRows(video.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      advice_summary: "手順が分かりやすいと好評でした。",
      triggered_by: "system",
      user_id: null,
      guest_id: null,
    });
    // 本文は「■ 見出し」と「・項目」の形。空のまとまり（否定的な意見から）は書かない。
    expect(rows[0].advice_text).toContain("■ 評価された点\n・手順が分かりやすい");
    expect(rows[0].advice_text).not.toContain("否定的な意見から");

    // 画面に返す形
    expect(await getAdviceOfOwnedVideo(owner, video.id)).toMatchObject({
      status: "done",
      state: "ready",
      advice: { summary: "手順が分かりやすいと好評でした。" },
    });

    // もう一度分析しても（分析するコメントがなくても）、アドバイスは増えない（1動画につき1つ。再生成はMVPの対象外）。
    await analyzeVideoComments(video, { ai });
    expect(await adviceRows(video.id)).toHaveLength(1);
    expect(ai.adviceInputs).toHaveLength(1);
  });

  it("AI に渡すのは集計済みのデータで、要注意とスパムの本文は渡さない（要件定義書12.2）", async () => {
    const { video } = await createGuestVideo(ENOUGH_COMMENTS);
    const ai = fakeAi();

    await analyzeVideoComments(video, { ai });

    const input = ai.adviceInputs[0];
    expect(input.analyzed_comment_count).toBe(ENOUGH_COMMENTS.length);
    // 7種すべての件数を入れる（0 の分類も）
    expect(input.category_counts).toEqual({
      question: 1,
      feedback: 2,
      praise: 6,
      negative_opinion: 0,
      harmful: 1,
      spam: 1,
      other: 0,
    });
    // 「音」の2件は、同じグループ（偽物の Embedding で同じベクトル）。いいねは 3 + 4。
    expect(input.top_feedback_clusters).toEqual([
      expect.objectContaining({ comment_count: 2, total_likes: 7 }),
    ]);
    expect(input.top_question_clusters).toHaveLength(1);
    // ポジティブの例は、いいねが多い順
    expect(input.praise_examples[0]).toEqual({ text: "勉強になりました", likes: 10 });
    const sent = JSON.stringify(input);
    expect(sent).not.toContain("攻撃的なひどいコメント");
    expect(sent).not.toContain("宣伝です");
  });

  it("分析が済んだコメントが少ないときは、作らずに done にする", async () => {
    const { owner, video } = await createGuestVideo(["最高でした", "音を大きくしてほしい"]);
    const ai = fakeAi();

    await analyzeVideoComments(video, { ai });

    expect(await analysisStatusOf(video.id)).toBe("done");
    expect(ai.adviceInputs).toHaveLength(0);
    expect(await adviceRows(video.id)).toHaveLength(0);
    expect(await getAdviceOfOwnedVideo(owner, video.id)).toEqual({
      status: "done",
      state: "too_few",
      advice: null,
    });
  });

  it("アドバイスづくりに失敗したら failed にし、「分析をやり直す」でアドバイスだけ作り直す", async () => {
    const { owner, video } = await createGuestVideo(ENOUGH_COMMENTS);

    await analyzeVideoComments(video, { ai: fakeAi({ failAdvice: true }) });
    expect(await analysisStatusOf(video.id)).toBe("failed");
    expect(await adviceRows(video.id)).toHaveLength(0);
    expect(await getAdviceOfOwnedVideo(owner, video.id)).toMatchObject({ state: "failed" });

    const ai = fakeAi();
    const run = await retryAnalysis(owner, video.id, ai);
    if (typeof run !== "function") throw new Error(`やり直せませんでした（${run}）`);
    await run();

    // コメントはすべて分析済みなので、分類は呼ばれず、アドバイスだけが作られる。
    expect(ai.classified).toHaveLength(0);
    expect(await analysisStatusOf(video.id)).toBe("done");
    expect(await adviceRows(video.id)).toHaveLength(1);
  });
});

describe("アドバイスのアクセス制御（要件定義書16章）", () => {
  afterAll(cleanup);

  it("ゲストBは、ゲストAの動画のアドバイスを読めない", async () => {
    const { owner: ownerA, video } = await createGuestVideo(ENOUGH_COMMENTS);
    await analyzeVideoComments(video, { ai: fakeAi() });
    const ownerB: Owner = { kind: "guest", guestId: newGuestId() };

    expect(await getAdviceOfOwnedVideo(ownerA, video.id)).toMatchObject({ state: "ready" });
    expect(await getAdviceOfOwnedVideo(ownerB, video.id)).toBeNull();
  });
});
