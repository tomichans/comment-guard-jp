import { afterAll, describe, expect, it } from "vitest";

import { CLASSIFY_BATCH_SIZE } from "@/lib/config/analysis";
import {
  getAnalysisSummaryOfOwnedVideo,
  listCommentThreadsOfOwnedVideo,
  type Owner,
} from "@/server/access";
import { analyzeVideoComments, retryAnalysis, runAfterRegister } from "@/server/analysis/analyze";
import { saveComments } from "@/server/comments/save";
import { registerVideo } from "@/server/videos/register";

import { fakeAi } from "./helpers/fake-ai";
import { fakeYouTube, page } from "./helpers/fake-youtube";
import { admin, cleanup, createTestUser, insertVideo, newGuestId } from "./helpers/db";

// =============================================================
// コメントの分析（要件定義書8章、9章、15.2）
// AI は偽物（fakeAi）、DB はローカルの Supabase を使う。NGワードは supabase/seed.sql の初期データ。
// =============================================================

/** ゲストの動画を作り、本文 texts の親コメントを保存する。 */
async function guestVideoWith(texts: string[], analysisStatus?: "analyzing" | "failed") {
  const guestId = newGuestId();
  const owner: Owner = { kind: "guest", guestId };
  const video = await insertVideo({ guestId, analysisStatus });
  if (texts.length === 0) return { owner, video, comments: [] };
  const { data, error } = await admin
    .from("comments")
    .insert(
      texts.map((text, i) => ({
        video_id: video.id,
        external_comment_id: `c-${i}-${crypto.randomUUID()}`,
        comment_text: text,
        posted_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
      })),
    )
    .select("id, comment_text");
  if (error) throw error;
  return { owner, video, comments: data };
}

async function latestAnalyses(videoId: string) {
  const { data, error } = await admin
    .from("comments")
    .select("comment_text, comment_analysis!inner(*)")
    .eq("video_id", videoId)
    .eq("comment_analysis.is_latest", true);
  if (error) throw error;
  return new Map(data.map((c) => [c.comment_text, c.comment_analysis[0]]));
}

async function statusOf(videoId: string) {
  const { data, error } = await admin.from("videos").select("analysis_status").eq("id", videoId).single();
  if (error) throw error;
  return data.analysis_status;
}

describe("コメントの分析", () => {
  afterAll(cleanup);

  it("すべてのコメントを分類して保存し、analysis_status を done にする", async () => {
    const { video } = await guestVideoWith(["最高でした", "これは何の曲ですか？", "字幕を付けてほしい"]);
    const ai = fakeAi();

    await analyzeVideoComments(video, { ai });

    const results = await latestAnalyses(video.id);
    expect(results.get("最高でした")).toMatchObject({ primary_category: "praise", labels: ["positive"] });
    expect(results.get("これは何の曲ですか？")).toMatchObject({ primary_category: "question" });
    expect(results.get("字幕を付けてほしい")).toMatchObject({ primary_category: "feedback", labels: ["request"] });
    expect(await statusOf(video.id)).toBe("done");
  });

  it("severity=5 の NGワードは AI に送らずに harmful、severity 1〜4 はヒントとして AI に渡す", async () => {
    const { video } = await guestVideoWith(["お前は死ね", "ゲームで敵を殺すのが楽しい"]);
    const ai = fakeAi();

    await analyzeVideoComments(video, { ai });

    expect(ai.classified.flat()).toEqual(["ゲームで敵を殺すのが楽しい"]);
    expect(ai.hints.get("ゲームで敵を殺すのが楽しい")).toEqual(["殺す"]);
    const results = await latestAnalyses(video.id);
    expect(results.get("お前は死ね")).toMatchObject({
      primary_category: "harmful",
      score: 1,
      ng_words: ["死ね"],
      review_required: false,
    });
    // ヒットしたのに harmful にならなかったので、人の確認が必要
    expect(results.get("ゲームで敵を殺すのが楽しい")).toMatchObject({
      primary_category: "praise",
      ng_words: ["殺す"],
      review_required: true,
    });
  });

  it("Moderation API が flagged なら harmful に上書きする", async () => {
    const { video } = await guestVideoWith(["攻撃的なコメント"]);

    await analyzeVideoComments(video, { ai: fakeAi() });

    expect((await latestAnalyses(video.id)).get("攻撃的なコメント")).toMatchObject({
      primary_category: "harmful",
      score: 0.9,
    });
  });

  it("AI が失敗したら failed にし、分析済みの結果は残す。やり直すと、残りだけを分析する", async () => {
    // 2まとまり分のコメント（51件以上）を作り、2回目の AI の呼び出しを失敗させる。
    const texts = Array.from({ length: CLASSIFY_BATCH_SIZE + 10 }, (_, i) => `コメント${i}`);
    const { owner, video } = await guestVideoWith(texts);

    await analyzeVideoComments(video, { ai: fakeAi({ failOnCall: 2 }) });

    expect(await statusOf(video.id)).toBe("failed");
    const analyzedBefore = (await latestAnalyses(video.id)).size;
    expect(analyzedBefore).toBe(CLASSIFY_BATCH_SIZE);

    // 失敗した動画では、「すべて」タブに分析されていないコメントも出る（要件定義書15.2）。
    const all = await listCommentThreadsOfOwnedVideo(owner, video.id, { tab: "all" });
    expect(all!.total).toBe(texts.length);
    const summary = await getAnalysisSummaryOfOwnedVideo(owner, video.id);
    expect(summary).toMatchObject({ status: "failed", total: texts.length, analyzed: CLASSIFY_BATCH_SIZE });

    const ai = fakeAi();
    const run = await retryAnalysis(owner, video.id, ai);
    expect(typeof run).toBe("function");
    // ボタンを2回押しても、2回目は受け付けない
    expect(await retryAnalysis(owner, video.id, ai)).toBe("not_failed");
    await (run as () => Promise<void>)();

    expect(ai.classified.flat()).toHaveLength(texts.length - analyzedBefore);
    expect((await latestAnalyses(video.id)).size).toBe(texts.length);
    expect(await statusOf(video.id)).toBe("done");
  });

  it("分析中は、分析が済んだコメントだけを一覧に出し、タブで絞り込める", async () => {
    const { owner, video } = await guestVideoWith(["最高でした", "これは何の曲ですか？", "未分析のコメント"]);
    // 2件だけ分析済みにする（残り1件は分析中）
    const { data: rows } = await admin
      .from("comments")
      .select("id, comment_text")
      .eq("video_id", video.id)
      .neq("comment_text", "未分析のコメント");
    await admin.from("comment_analysis").insert(
      rows!.map((r) => ({
        comment_id: r.id,
        analyzed_at: new Date().toISOString(),
        primary_category: r.comment_text.includes("？") ? ("question" as const) : ("praise" as const),
      })),
    );

    const all = await listCommentThreadsOfOwnedVideo(owner, video.id, { tab: "all" });
    expect(all!.threads.map((t) => t.comment_text).sort()).toEqual(["これは何の曲ですか？", "最高でした"]);
    const questions = await listCommentThreadsOfOwnedVideo(owner, video.id, { tab: "question" });
    expect(questions!.threads.map((t) => t.comment_text)).toEqual(["これは何の曲ですか？"]);
    expect(questions!.threads[0].analysis).toMatchObject({ primary_category: "question" });

    const summary = await getAnalysisSummaryOfOwnedVideo(owner, video.id);
    expect(summary).toMatchObject({ status: "analyzing", total: 3, analyzed: 2 });
    expect(summary!.counts).toMatchObject({ praise: 1, question: 1, harmful: 0, all: 2 });
  });

  it("本文が変わったコメントは、古い結果を履歴として残し、もう一度分析する", async () => {
    const { video } = await guestVideoWith([]);
    const comment = {
      externalId: `edit-${crypto.randomUUID()}`,
      parentExternalId: null,
      author: "投稿者",
      likeCount: 0,
      postedAt: "2026-10-01T00:00:00Z",
      replyCount: 0,
    };
    await saveComments(admin, video.id, [{ ...comment, text: "最高でした" }]);
    await analyzeVideoComments(video, { ai: fakeAi() });

    await saveComments(admin, video.id, [{ ...comment, text: "これは何の曲ですか？" }]);
    await analyzeVideoComments(video, { ai: fakeAi() });

    const { data, error } = await admin
      .from("comments")
      .select("comment_analysis(primary_category, is_latest)")
      .eq("video_id", video.id)
      .single();
    if (error) throw error;
    expect(data.comment_analysis).toHaveLength(2);
    expect(data.comment_analysis.find((a) => a.is_latest)).toMatchObject({ primary_category: "question" });
  });

  it("登録の後に、残りのコメントの取得と分析を両方終える（ログインユーザー）", async () => {
    const u = await createTestUser();
    const youtube = fakeYouTube({ pages: [page("p1", 100, "NEXT"), page("p2", 30, null)] });
    const { video, fetchRemaining } = await registerVideo(
      { kind: "user", userId: u.userId },
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      youtube,
    );
    expect(video.analysis_status).toBe("analyzing");

    await runAfterRegister(video, fetchRemaining, fakeAi())();

    const { data, error } = await admin.from("videos").select("fetch_status, analysis_status").eq("id", video.id).single();
    if (error) throw error;
    expect(data).toEqual({ fetch_status: "done", analysis_status: "done" });
    expect((await latestAnalyses(video.id)).size).toBe(130);
  });
});

// 分析結果も、動画の持ち主しか読めないこと（要件定義書16章）
describe("分析結果のアクセス制御", () => {
  afterAll(cleanup);

  it("ゲストBは、ゲストAの動画の分析結果・進み具合を読めず、分析のやり直しもできない", async () => {
    const { video } = await guestVideoWith(["最高でした"], "failed");
    const guestB: Owner = { kind: "guest", guestId: newGuestId() };

    expect(await listCommentThreadsOfOwnedVideo(guestB, video.id, { tab: "praise" })).toBeNull();
    expect(await getAnalysisSummaryOfOwnedVideo(guestB, video.id)).toBeNull();
    expect(await retryAnalysis(guestB, video.id, fakeAi())).toBe("not_found");
    expect(await statusOf(video.id)).toBe("failed");
  });
});
