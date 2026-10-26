import { afterAll, describe, expect, it } from "vitest";

import { CLASSIFY_BATCH_SIZE } from "@/lib/config/analysis";
import type { Enums } from "@/lib/database.types";
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
//
// AI は偽物（tests/helpers/fake-ai.ts）を使う。どの本文がどう分類されるかは、そのファイルの先頭に書いてある。
// DB はローカルの Supabase を使う。NGワードは supabase/seed.sql の初期データ（「死ね」は severity 5、「殺す」は 2）。
// =============================================================

// ---------- このファイルだけで使う小さな道具 ----------

/** ゲストの動画を1本作り、texts の本文の親コメントを保存する。 */
async function createGuestVideo(texts: string[], analysisStatus?: "analyzing" | "failed") {
  const guestId = newGuestId();
  const owner: Owner = { kind: "guest", guestId };
  const video = await insertVideo({ guestId, analysisStatus });

  if (texts.length === 0) return { owner, video, comments: [] };

  const { data: comments, error } = await admin
    .from("comments")
    .insert(
      texts.map((text, i) => ({
        video_id: video.id,
        external_comment_id: `c-${i}-${crypto.randomUUID()}`,
        comment_text: text,
        // 1分ずつずらして、並び順が毎回同じになるようにする
        posted_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
      })),
    )
    .select("id, comment_text");
  if (error) throw error;
  return { owner, video, comments };
}

/** 動画のコメントの「最新の分析結果」を、本文 → 分析結果 の Map で返す。分析されていないコメントは入らない。 */
async function latestAnalyses(videoId: string) {
  const { data, error } = await admin
    .from("comments")
    // [Supabase固有] comment_analysis!inner：分析結果が1つもないコメントは、結果から外す（SQL の INNER JOIN）
    .select("comment_text, comment_analysis!inner(*)")
    .eq("video_id", videoId)
    .eq("comment_analysis.is_latest", true);
  if (error) throw error;
  return new Map(data.map((c) => [c.comment_text, c.comment_analysis[0]]));
}

/** DB に保存されている、動画の analysis_status を返す。 */
async function analysisStatusOf(videoId: string) {
  const { data, error } = await admin.from("videos").select("analysis_status").eq("id", videoId).single();
  if (error) throw error;
  return data.analysis_status;
}

/** AI を通さずに、コメントに分析結果を直接書き込む（「一部だけ分析が済んだ」状態を作るため）。 */
async function saveAnalysis(commentId: string, category: Enums<"primary_category">) {
  const { error } = await admin.from("comment_analysis").insert({
    comment_id: commentId,
    analyzed_at: new Date().toISOString(),
    primary_category: category,
  });
  if (error) throw error;
}

// ---------- テスト ----------

describe("コメントを分類して保存する", () => {
  afterAll(cleanup);

  it("すべてのコメントを分類して保存し、analysis_status を done にする", async () => {
    // 準備：偽物の AI が question / feedback / praise に分ける本文を1つずつ
    const { video } = await createGuestVideo(["最高でした", "これは何の曲ですか？", "字幕を表示してほしい"]);

    // 実行
    await analyzeVideoComments(video, { ai: fakeAi() });

    // 確認
    const results = await latestAnalyses(video.id);
    expect(results.get("最高でした")).toMatchObject({ primary_category: "praise", labels: ["positive"] });
    expect(results.get("これは何の曲ですか？")).toMatchObject({ primary_category: "question" });
    expect(results.get("字幕を表示してほしい")).toMatchObject({ primary_category: "feedback", labels: ["request"] });
    expect(await analysisStatusOf(video.id)).toBe("done");
  });

  it("severity=5 の NGワードは AI に送らずに harmful。severity 1〜4 はヒントとして AI に渡す", async () => {
    const { video } = await createGuestVideo(["お前は死ね", "ゲームで敵を殺すのが楽しい"]);
    const ai = fakeAi();

    await analyzeVideoComments(video, { ai });

    // AI に送られたのは「殺す」の方だけで、ヒントとして「殺す」が付いている
    expect(ai.classified.flat()).toEqual(["ゲームで敵を殺すのが楽しい"]);
    expect(ai.hints.get("ゲームで敵を殺すのが楽しい")).toEqual(["殺す"]);

    const results = await latestAnalyses(video.id);
    // 「死ね」は AI を通さずに harmful（確信度1）
    expect(results.get("お前は死ね")).toMatchObject({
      primary_category: "harmful",
      score: 1,
      ng_words: ["死ね"],
      review_required: false,
    });
    // NGワードにヒットしたのに harmful にならなかったので、人の確認が必要（要件定義書9.2）
    expect(results.get("ゲームで敵を殺すのが楽しい")).toMatchObject({
      primary_category: "praise",
      ng_words: ["殺す"],
      review_required: true,
    });
  });

  it("Moderation API が flagged なら、AI の分類に関係なく harmful に上書きする", async () => {
    // 偽物の AI は、この本文を praise に分類するが、Moderation API は flagged にする
    const { video } = await createGuestVideo(["攻撃的なコメント"]);

    await analyzeVideoComments(video, { ai: fakeAi() });

    const results = await latestAnalyses(video.id);
    expect(results.get("攻撃的なコメント")).toMatchObject({ primary_category: "harmful", score: 0.9 });
  });
});

describe("AI が失敗したときと、分析のやり直し（要件定義書15.2）", () => {
  afterAll(cleanup);

  it("失敗したら failed にし、分析済みの結果は残す。やり直すと、残りだけを分析する", async () => {
    // 準備：AI に2回に分けて送る量（50件 + 10件）のコメントを作る
    const texts = Array.from({ length: CLASSIFY_BATCH_SIZE + 10 }, (_, i) => `コメント${i}`);
    const { owner, video } = await createGuestVideo(texts);

    // 実行：2回目の AI の呼び出しを失敗させる
    await analyzeVideoComments(video, { ai: fakeAi({ failOnCall: 2 }) });

    // 確認：1回目の50件だけが保存され、動画は failed
    expect(await analysisStatusOf(video.id)).toBe("failed");
    expect((await latestAnalyses(video.id)).size).toBe(CLASSIFY_BATCH_SIZE);

    // 確認：失敗した動画では、「すべて」タブに分析されていないコメントも出る
    const allTab = await listCommentThreadsOfOwnedVideo(owner, video.id, { tab: "all" });
    expect(allTab?.total).toBe(texts.length);
    const summary = await getAnalysisSummaryOfOwnedVideo(owner, video.id);
    expect(summary).toMatchObject({ status: "failed", total: texts.length, analyzed: CLASSIFY_BATCH_SIZE });

    // 実行：「分析をやり直す」ボタン。受け付けられると、裏で実行する関数が返ってくる
    const ai = fakeAi();
    const startRetry = await retryAnalysis(owner, video.id, ai);
    if (typeof startRetry !== "function") throw new Error(`やり直しが受け付けられなかった：${startRetry}`);

    // 確認：その関数を実行する前にもう一度押しても、2回目は受け付けない
    expect(await retryAnalysis(owner, video.id, ai)).toBe("not_failed");

    await startRetry();

    // 確認：AI に送られたのは残りの10件だけで、全件が分析済みになった
    expect(ai.classified.flat()).toHaveLength(10);
    expect((await latestAnalyses(video.id)).size).toBe(texts.length);
    expect(await analysisStatusOf(video.id)).toBe("done");
  });
});

describe("分析中の一覧と件数（要件定義書4.3）", () => {
  afterAll(cleanup);

  it("分析が済んだコメントだけを一覧に出し、タブで絞り込める", async () => {
    // 準備：3件のうち2件だけ分析済みにする（動画は analyzing のまま）
    const { owner, video, comments } = await createGuestVideo(["最高でした", "これは何の曲ですか？", "未分析のコメント"]);
    const idOf = (text: string) => comments.find((c) => c.comment_text === text)!.id;
    await saveAnalysis(idOf("最高でした"), "praise");
    await saveAnalysis(idOf("これは何の曲ですか？"), "question");

    // 確認：「すべて」タブに出るのは、分析済みの2件だけ
    const allTab = await listCommentThreadsOfOwnedVideo(owner, video.id, { tab: "all" });
    expect(allTab?.threads.map((t) => t.comment_text).sort()).toEqual(["これは何の曲ですか？", "最高でした"]);

    // 確認：「質問」タブには質問だけが、分析結果付きで出る
    const questionTab = await listCommentThreadsOfOwnedVideo(owner, video.id, { tab: "question" });
    expect(questionTab?.threads).toHaveLength(1);
    expect(questionTab?.threads[0]).toMatchObject({
      comment_text: "これは何の曲ですか？",
      analysis: { primary_category: "question" },
    });

    // 確認：進み具合とタブごとの件数
    const summary = await getAnalysisSummaryOfOwnedVideo(owner, video.id);
    expect(summary).toMatchObject({
      status: "analyzing",
      total: 3,
      analyzed: 2,
      counts: { praise: 1, question: 1, harmful: 0, all: 2 },
    });
  });
});

describe("本文が変わったコメントの再分析（要件定義書7.4）", () => {
  afterAll(cleanup);

  it("古い結果を履歴として残し、新しい本文でもう一度分析する", async () => {
    const { video } = await createGuestVideo([]);
    // YouTube から取得したコメント1件（本文以外の部分）
    const comment = {
      externalId: `edit-${crypto.randomUUID()}`,
      parentExternalId: null,
      author: "投稿者",
      likeCount: 0,
      postedAt: "2026-10-01T00:00:00Z",
      replyCount: 0,
    };

    // 1回目：「最高でした」として保存して分析する → praise
    await saveComments(admin, video.id, [{ ...comment, text: "最高でした" }]);
    await analyzeVideoComments(video, { ai: fakeAi() });

    // 2回目：同じコメントの本文が質問に変わった → 保存して、もう一度分析する
    await saveComments(admin, video.id, [{ ...comment, text: "これは何の曲ですか？" }]);
    await analyzeVideoComments(video, { ai: fakeAi() });

    const { data, error } = await admin
      .from("comments")
      .select("comment_analysis(primary_category, is_latest)")
      .eq("video_id", video.id)
      .single();
    if (error) throw error;
    // 分析結果は2行（古い結果も消さない）で、最新は question
    expect(data.comment_analysis).toHaveLength(2);
    expect(data.comment_analysis.find((a) => a.is_latest)).toMatchObject({ primary_category: "question" });
  });
});

describe("動画の登録の後に裏で行う処理（要件定義書5章、7.2）", () => {
  afterAll(cleanup);

  it("ログインユーザーは、残りのコメントの取得と分析を両方終える", async () => {
    // 準備：YouTube に 100件 + 30件 のコメントがある
    const user = await createTestUser();
    const youtube = fakeYouTube({ pages: [page("p1", 100, "NEXT"), page("p2", 30, null)] });
    const { video, fetchRemaining } = await registerVideo(
      { kind: "user", userId: user.userId },
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      youtube,
    );
    expect(video.analysis_status).toBe("analyzing");

    // 実行：本番では after() に渡す関数を、テストではその場で実行して終わるのを待つ
    const runInBackground = runAfterRegister(video, fetchRemaining, fakeAi());
    await runInBackground();

    // 確認：取得も分析も終わり、130件すべてが分析済み
    const { data, error } = await admin.from("videos").select("fetch_status, analysis_status").eq("id", video.id).single();
    if (error) throw error;
    expect(data).toEqual({ fetch_status: "done", analysis_status: "done" });
    expect((await latestAnalyses(video.id)).size).toBe(130);
  });
});

describe("分析結果のアクセス制御（要件定義書16章）", () => {
  afterAll(cleanup);

  it("ゲストBは、ゲストAの動画の分析結果・進み具合を読めず、分析のやり直しもできない", async () => {
    const { video } = await createGuestVideo(["最高でした"], "failed");
    const guestB: Owner = { kind: "guest", guestId: newGuestId() };

    expect(await listCommentThreadsOfOwnedVideo(guestB, video.id, { tab: "praise" })).toBeNull();
    expect(await getAnalysisSummaryOfOwnedVideo(guestB, video.id)).toBeNull();
    expect(await retryAnalysis(guestB, video.id, fakeAi())).toBe("not_found");
    // ゲストBのやり直しで、ゲストAの動画の状態が変わっていない
    expect(await analysisStatusOf(video.id)).toBe("failed");
  });
});
