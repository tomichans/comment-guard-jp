import { afterAll, describe, expect, it } from "vitest";

import { getRankingsOfOwnedVideo, listCommentThreadsOfOwnedVideo, type Owner } from "@/server/access";
import { analyzeVideoComments } from "@/server/analysis/analyze";
import { saveComments } from "@/server/comments/save";

import { fakeAi } from "./helpers/fake-ai";
import { admin, cleanup, insertVideo, newGuestId } from "./helpers/db";

// =============================================================
// 類似したコメントのグルーピングと、ランキング（要件定義書10章、11章）
//
// AI は偽物（tests/helpers/fake-ai.ts）を使う。
//   - 「宣伝」を含む → スパム、「？」を含む → 質問、「してほしい」を含む → 指摘・要望、それ以外 → ポジティブ
//   - 「攻撃」を含む → 要注意（Moderation API が flagged）
//   - 「？」を含めば質問の論点、「してほしい」を含めば指摘・要望の論点（どちらも「論点：」＋本文。分類には関係なく出る）
//   - 「音」「字幕」「曲」「機材」のどれかを含む論点は、その話題ごとに同じ Embedding になる（＝同じグループ）
//   - グループの見出し（代表論点）は、最初の1件の論点
// DB はローカルの Supabase を使う。
// =============================================================

type TestComment = { text: string; likes?: number; parent?: number };

/** ゲストの動画を1本作り、コメントを保存する。parent に番号を書いたコメントは、その番号のコメントへの返信。 */
async function createGuestVideo(comments: TestComment[]) {
  const guestId = newGuestId();
  const owner: Owner = { kind: "guest", guestId };
  const video = await insertVideo({ guestId });
  const externalId = (i: number) => `${video.id}-c${i}`;
  await saveComments(
    admin,
    video.id,
    comments.map((c, i) => ({
      externalId: externalId(i),
      parentExternalId: c.parent === undefined ? null : externalId(c.parent),
      text: c.text,
      author: "投稿者",
      likeCount: c.likes ?? 0,
      // 1分ずつずらして、並び順を毎回同じにする
      postedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
      replyCount: 0,
    })),
  );
  return { owner, video };
}

/** 動画のグループを、代表論点 → 件数 の形で返す（件数0のグループも含む）。代表論点が同じグループがある動画では使わない。 */
async function groupCounts(videoId: string) {
  const { data, error } = await admin
    .from("comment_groups")
    .select("group_type, representative_text, comment_count")
    .eq("video_id", videoId);
  if (error) throw error;
  return Object.fromEntries(data.map((g) => [g.representative_text, g.comment_count]));
}

/** 本文 → 最新の分析結果の論点ごとの、ランキングの種類、group_id、embedding があるか */
async function topicsOfComment(videoId: string, text: string) {
  const { data, error } = await admin
    .from("comments")
    .select("comment_analysis!inner(comment_topics(group_type, group_id, embedding))")
    .eq("video_id", videoId)
    .eq("comment_text", text)
    .eq("comment_analysis.is_latest", true)
    .single();
  if (error) throw error;
  return data.comment_analysis[0].comment_topics
    .map((t) => ({ groupType: t.group_type, groupId: t.group_id, hasEmbedding: t.embedding !== null }))
    .sort((a, b) => a.groupType.localeCompare(b.groupType));
}

describe("似たコメントをグループにまとめる（要件定義書10章）", () => {
  afterAll(cleanup);

  it("同じ話題の指摘・要望は1つのグループになり、質問は別のグループになる", async () => {
    // 準備
    const { video } = await createGuestVideo([
      { text: "音が小さいので直してほしい" },
      { text: "BGMの音を小さくしてほしい" },
      { text: "字幕を表示してほしい" },
      { text: "この曲は何ですか？" },
      { text: "最高でした" },
    ]);

    // 実行
    const ai = fakeAi();
    await analyzeVideoComments(video, { ai });

    // 確認：分類の AI には、動画のタイトルも渡している（論点から動画の主題を省くため）
    expect(ai.videoTitles[0]).toBe(video.title);
    // 確認：グループは3つ。見出し（代表論点）は、最初の1件（古いコメント）の論点
    expect(await groupCounts(video.id)).toEqual({
      "論点：音が小さいので直してほしい": 2,
      "論点：字幕を表示してほしい": 1,
      "論点：この曲は何ですか？": 1,
    });
    // 論点のないコメント（ポジティブ）はグループに入らず、embedding も作らない
    expect(await topicsOfComment(video.id, "最高でした")).toEqual([]);
  });

  it("要注意のコメントもグループに入れる。返信とスパムは入れない", async () => {
    const { video } = await createGuestVideo([
      { text: "字幕を表示してほしい" },
      // 返信は対象外【確定】
      { text: "字幕があると助かるので表示してほしい", parent: 0 },
      // スパムは対象外（論点があっても）
      { text: "宣伝です。字幕を表示してほしい" },
      // 偽物の Moderation API が「攻撃」を harmful にする。言い方がきつくても、中身の要望は数える【確定】
      { text: "攻撃的に字幕を表示してほしい" },
    ]);

    const ai = fakeAi();
    await analyzeVideoComments(video, { ai });

    // 確認：Embedding を作ったのは、親コメントの論点だけ（本文ではなく論点を比べる）
    expect(ai.embedded.flat()).toEqual(["論点：字幕を表示してほしい", "論点：攻撃的に字幕を表示してほしい"]);
    expect(await groupCounts(video.id)).toEqual({ "論点：字幕を表示してほしい": 2 });
  });

  it("質問と要望の両方を含むコメントは、両方のランキングに数える", async () => {
    const { owner, video } = await createGuestVideo([{ text: "字幕を表示してほしい。この曲は何ですか？" }]);

    await analyzeVideoComments(video, { ai: fakeAi() });

    // 確認：論点が2つあり、それぞれ別のランキングのグループに入っている
    const topics = await topicsOfComment(video.id, "字幕を表示してほしい。この曲は何ですか？");
    expect(topics.map((t) => [t.groupType, t.groupId !== null])).toEqual([
      ["feedback_request", true],
      ["question", true],
    ]);
    const rankings = await getRankingsOfOwnedVideo(owner, video.id);
    expect(rankings?.question.map((r) => r.count)).toEqual([1]);
    expect(rankings?.feedbackRequest.map((r) => r.count)).toEqual([1]);
  });

  it("本文が変わって別のグループに移ったコメントは、元のグループの件数から抜ける", async () => {
    // 準備：音の指摘を2件にしてから、1件の本文を字幕の要望に変える
    const { video } = await createGuestVideo([
      { text: "音が小さいので直してほしい" },
      { text: "BGMの音を小さくしてほしい" },
    ]);
    await analyzeVideoComments(video, { ai: fakeAi() });
    expect(await groupCounts(video.id)).toEqual({ "論点：音が小さいので直してほしい": 2 });

    // 実行：同じコメント（外部ID）の本文が変わったものとして保存し、もう一度分析する
    await saveComments(admin, video.id, [
      {
        externalId: `${video.id}-c1`,
        parentExternalId: null,
        text: "字幕を表示してほしい",
        author: "投稿者",
        likeCount: 0,
        postedAt: new Date(Date.UTC(2026, 9, 1, 0, 1)).toISOString(),
        replyCount: 0,
      },
    ]);
    await analyzeVideoComments(video, { ai: fakeAi() });

    // 確認：件数は数え直されて、音は1件、字幕は1件
    expect(await groupCounts(video.id)).toEqual({
      "論点：音が小さいので直してほしい": 1,
      "論点：字幕を表示してほしい": 1,
    });
  });

  it("Embedding に失敗したら failed にし、分類の結果は残す。やり直すとグループに入る", async () => {
    const { video } = await createGuestVideo([{ text: "字幕を表示してほしい" }]);

    // 実行：Embedding を失敗させる
    await analyzeVideoComments(video, { ai: fakeAi({ failEmbedding: true }) });

    // 確認：分類と論点は保存されているが、グループはない
    const { data: status } = await admin.from("videos").select("analysis_status").eq("id", video.id).single();
    expect(status?.analysis_status).toBe("failed");
    expect(await topicsOfComment(video.id, "字幕を表示してほしい")).toEqual([
      { groupType: "feedback_request", groupId: null, hasEmbedding: false },
    ]);

    // 実行：やり直す（分類するコメントは残っていないが、グループへの振り分けは行う）
    const ai = fakeAi();
    await analyzeVideoComments(video, { ai });

    // 確認：AI の分類は呼ばれずに、グループに入った
    expect(ai.classified.flat()).toEqual([]);
    expect(await groupCounts(video.id)).toEqual({ "論点：字幕を表示してほしい": 1 });
  });
});

describe("ランキング（要件定義書11章）", () => {
  afterAll(cleanup);

  it("件数が多い順。件数が同じなら、いいねの合計が多い順。上位3件まで", async () => {
    // 準備：指摘・要望のグループを4つ作る
    //   音 2件（いいね 0）、字幕 1件（いいね 5）、曲 1件（いいね 10）、機材 1件（いいね 1）
    const { owner, video } = await createGuestVideo([
      { text: "音が小さいので直してほしい" },
      { text: "BGMの音を小さくしてほしい" },
      { text: "字幕を表示してほしい", likes: 5 },
      { text: "曲名を概要欄に記載してほしい", likes: 10 },
      { text: "機材を紹介してほしい", likes: 1 },
    ]);
    await analyzeVideoComments(video, { ai: fakeAi() });

    // 実行
    const rankings = await getRankingsOfOwnedVideo(owner, video.id);

    // 確認：音（2件）が1位。1件どうしは、いいねの多い曲、字幕の順。機材は4位なので出ない
    // id（グループの id）は、ランキングを選んだときのコメント一覧の絞り込みに使う
    expect(rankings).toEqual({
      status: "done",
      feedbackRequest: [
        { id: expect.any(String), rank: 1, text: "論点：音が小さいので直してほしい", count: 2 },
        { id: expect.any(String), rank: 2, text: "論点：曲名を概要欄に記載してほしい", count: 1 },
        { id: expect.any(String), rank: 3, text: "論点：字幕を表示してほしい", count: 1 },
      ],
      question: [],
    });
  });

  it("件数もいいねも同じなら、新しいコメントがあるグループを上にする", async () => {
    // 準備：あとに書かれた（新しい）のは字幕のコメント
    const { owner, video } = await createGuestVideo([
      { text: "この曲は何ですか？" },
      { text: "字幕はどこで設定できますか？" },
    ]);
    await analyzeVideoComments(video, { ai: fakeAi() });

    const rankings = await getRankingsOfOwnedVideo(owner, video.id);

    expect(rankings?.question.map((r) => r.text)).toEqual([
      "論点：字幕はどこで設定できますか？",
      "論点：この曲は何ですか？",
    ]);
  });

  it("件数が0になったグループは出さない", async () => {
    const { owner, video } = await createGuestVideo([{ text: "字幕を表示してほしい" }]);
    await analyzeVideoComments(video, { ai: fakeAi() });
    // 準備：分析結果を古いもの（is_latest = false）にして、件数を数え直す（本文が変わって、まだ分析し直していない状態）
    const { data: comment } = await admin.from("comments").select("id").eq("video_id", video.id).single();
    await admin.from("comment_analysis").update({ is_latest: false }).eq("comment_id", comment!.id);
    await admin.rpc("refresh_group_counts", { p_video_id: video.id });
    expect(await groupCounts(video.id)).toEqual({ "論点：字幕を表示してほしい": 0 });

    const rankings = await getRankingsOfOwnedVideo(owner, video.id);

    expect(rankings?.feedbackRequest).toEqual([]);
  });

  it("ゲストBは、ゲストAの動画のランキングを読めない（アクセス制御）", async () => {
    const { video } = await createGuestVideo([{ text: "字幕を表示してほしい" }]);
    const guestB: Owner = { kind: "guest", guestId: newGuestId() };

    expect(await getRankingsOfOwnedVideo(guestB, video.id)).toBeNull();
  });
});

describe("ランキングを選んだときのコメント一覧（グループで絞り込む）", () => {
  afterAll(cleanup);

  it("グループに入っているコメントだけを返し、グループの見出しも返す", async () => {
    // 準備：音のグループ（2件）と、字幕のグループ（1件）
    const { owner, video } = await createGuestVideo([
      { text: "音が小さいので直してほしい" },
      { text: "BGMの音を小さくしてほしい" },
      { text: "字幕を表示してほしい" },
      { text: "最高でした" },
    ]);
    await analyzeVideoComments(video, { ai: fakeAi() });
    const rankings = await getRankingsOfOwnedVideo(owner, video.id);
    const sound = rankings!.feedbackRequest[0];

    // 実行
    const page = await listCommentThreadsOfOwnedVideo(owner, video.id, { group: sound.id });

    // 確認：ランキングの件数と同じコメントが出る（新しい順。どれもおだやかなコメント）
    expect(page?.threads.map((t) => t.comment_text)).toEqual([
      "BGMの音を小さくしてほしい",
      "音が小さいので直してほしい",
    ]);
    expect(page?.total).toBe(sound.count);
    expect(page?.group).toEqual({
      id: sound.id,
      group_type: "feedback_request",
      representative_text: "論点：音が小さいので直してほしい",
    });
  });

  it("おだやか・要注意のタブで分けて返し、タブごとの件数も返す", async () => {
    // 準備：字幕のグループに、おだやかなコメント2件と、要注意のコメント1件
    const { owner, video } = await createGuestVideo([
      { text: "字幕を表示してほしい" },
      { text: "字幕を大きく表示してほしい" },
      { text: "攻撃的に字幕を表示してほしい" },
    ]);
    await analyzeVideoComments(video, { ai: fakeAi() });
    const group = (await getRankingsOfOwnedVideo(owner, video.id))!.feedbackRequest[0];
    expect(group.count).toBe(3);

    // 実行
    const calm = await listCommentThreadsOfOwnedVideo(owner, video.id, { group: group.id });
    const harmful = await listCommentThreadsOfOwnedVideo(owner, video.id, {
      group: group.id,
      groupTab: "harmful",
    });

    // 確認：既定はおだやかなコメント。要注意のタブには要注意のコメントだけ
    expect(calm?.threads.map((t) => t.comment_text)).toEqual(["字幕を大きく表示してほしい", "字幕を表示してほしい"]);
    expect(harmful?.threads.map((t) => t.comment_text)).toEqual(["攻撃的に字幕を表示してほしい"]);
    expect(calm?.groupCounts).toEqual({ calm: 2, harmful: 1 });
    // 画面に渡す分析結果には、論点（comment_topics）を含めない
    expect(Object.keys(calm!.threads[0].analysis!).sort()).toEqual(["labels", "primary_category", "review_required"]);
  });

  it("他の動画のグループの id を渡しても、コメントは出ない（アクセス制御）", async () => {
    // 準備：ゲストAの動画のグループ
    const a = await createGuestVideo([{ text: "字幕を表示してほしい" }]);
    await analyzeVideoComments(a.video, { ai: fakeAi() });
    const groupOfA = (await getRankingsOfOwnedVideo(a.owner, a.video.id))!.feedbackRequest[0].id;
    // ゲストBの動画
    const b = await createGuestVideo([{ text: "字幕を表示してほしい" }]);
    await analyzeVideoComments(b.video, { ai: fakeAi() });

    // 実行：ゲストBが、自分の動画の一覧に、ゲストAのグループの id を付けて読む
    const page = await listCommentThreadsOfOwnedVideo(b.owner, b.video.id, { group: groupOfA });

    // 確認：見つからない扱い（ゲストAのコメントも、ゲストBのコメントも出ない）
    expect(page).toEqual({ threads: [], group: null, groupCounts: null, total: 0, nextOffset: null });
  });
});
