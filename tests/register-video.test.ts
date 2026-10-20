import { afterAll, describe, expect, it } from "vitest";

import { GUEST_DAILY_VIDEO_LIMIT } from "@/lib/config/limits";
import { VideoError } from "@/server/video-errors";
import { registerVideo, type Registrant } from "@/server/videos/register";

import { fakeYouTube, page } from "./helpers/fake-youtube";
import { admin, cleanup, createTestUser, newGuestId } from "./helpers/db";

// =============================================================
// 動画の登録とコメントの取得（要件定義書3.1、7章）
// YouTube は偽物（fakeYouTube）、DB はローカルの Supabase を使う。
// =============================================================

const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function guest(ipHash: string | null = `ip-${crypto.randomUUID()}`): Registrant {
  return { kind: "guest", guestId: newGuestId(), ipHash };
}

async function user(): Promise<Registrant> {
  const u = await createTestUser();
  return { kind: "user", userId: u.userId };
}

async function countComments(videoId: string, replies = false) {
  const query = admin.from("comments").select("id", { count: "exact", head: true }).eq("video_id", videoId);
  const { count, error } = await (replies
    ? query.not("parent_comment_id", "is", null)
    : query.is("parent_comment_id", null));
  if (error) throw error;
  return count;
}

async function usageOf(videoId: string) {
  const { data, error } = await admin
    .from("api_usage_logs")
    .select("*")
    .eq("video_id", videoId)
    .order("created_at");
  if (error) throw error;
  return data;
}

async function expectVideoError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(VideoError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("動画の登録", () => {
  afterAll(cleanup);

  it("ゲストは最新100スレッドだけを取得し、続きがあっても取得しない", async () => {
    const g = guest();
    const youtube = fakeYouTube({ pages: [page("g", 100, "NEXT")] });

    const { video, fetchRemaining } = await registerVideo(g, URL, youtube);

    expect(fetchRemaining).toBeNull();
    expect(video).toMatchObject({ video_id: "dQw4w9WgXcQ", fetch_status: "done", user_id: null });
    expect(youtube.calls).toEqual([{ maxResults: 100 }]);
    expect(await countComments(video.id)).toBe(100);
  });

  it("返信は、親コメントの内部 id に紐づけて保存する", async () => {
    const youtube = fakeYouTube({
      pages: [
        {
          comments: [
            { externalId: "p", parentExternalId: null, text: "親", author: null, likeCount: 1, postedAt: null },
            { externalId: "p.r", parentExternalId: "p", text: "返信", author: null, likeCount: 0, postedAt: null },
          ],
          threadCount: 1,
          nextPageToken: null,
        },
      ],
    });
    const { video } = await registerVideo(guest(), URL, youtube);

    const { data } = await admin.from("comments").select("*").eq("video_id", video.id);
    const parent = data!.find((c) => c.external_comment_id === "p")!;
    const reply = data!.find((c) => c.external_comment_id === "p.r")!;
    expect(parent.parent_comment_id).toBeNull();
    expect(reply.parent_comment_id).toBe(parent.id);
    expect(parent.body_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("YouTube の使用量を、呼び出しごとに記録する（ゲストは ip_hash 付き）", async () => {
    const g = guest("ip-usage-test");
    const { video } = await registerVideo(g, URL, fakeYouTube({ pages: [page("u", 3, null)] }));

    const usage = await usageOf(video.id);
    expect(usage.map((u) => u.endpoint)).toEqual(["videos.list", "commentThreads.list"]);
    expect(usage[0]).toMatchObject({
      service: "youtube",
      units: 1,
      succeeded: true,
      guest_id: g.kind === "guest" ? g.guestId : null,
      ip_hash: "ip-usage-test",
      user_id: null,
    });
  });

  it("URL が不正なら、YouTube に問い合わせずにエラー", async () => {
    const youtube = fakeYouTube({ pages: [] });
    await expectVideoError(registerVideo(guest(), "https://example.com", youtube), "invalid_url");
    expect(youtube.calls).toHaveLength(0);
  });

  it("動画が見つからない・コメントが無効のときは、動画を作らない", async () => {
    const g1 = guest();
    await expectVideoError(
      registerVideo(g1, URL, fakeYouTube({ video: null, pages: [] })),
      "video_not_found",
    );
    const g2 = guest();
    await expectVideoError(
      registerVideo(g2, URL, fakeYouTube({ pages: ["comments_disabled"] })),
      "comments_disabled",
    );

    for (const g of [g1, g2]) {
      const { data } = await admin
        .from("videos")
        .select("id")
        .eq("guest_id", g.kind === "guest" ? g.guestId : "");
      expect(data).toHaveLength(0);
    }
  });
});

describe("ゲストの上限（要件定義書3.1）", () => {
  afterAll(cleanup);

  it("同じゲストの2本目は guest_video_limit", async () => {
    const g = guest();
    await registerVideo(g, URL, fakeYouTube({ pages: [page("a", 1, null)] }));
    await expectVideoError(
      registerVideo(g, URL, fakeYouTube({ pages: [page("b", 1, null)] })),
      "guest_video_limit",
    );
  });

  it("期限切れの動画が残っていても、新しい動画を登録できる", async () => {
    const g = guest();
    const { video } = await registerVideo(g, URL, fakeYouTube({ pages: [page("a", 1, null)] }));
    // 25時間前に作られたことにする（ゲストの保持期間は24時間）
    await admin
      .from("videos")
      .update({ created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })
      .eq("id", video.id);

    const second = await registerVideo(g, URL, fakeYouTube({ pages: [page("b", 1, null)] }));
    expect(second.video.id).not.toBe(video.id);
  });

  it(`同じIPからは、24時間に${GUEST_DAILY_VIDEO_LIMIT}回まで（Cookie を変えても数える）`, async () => {
    const ipHash = `ip-${crypto.randomUUID()}`;
    // 存在しない動画でも、YouTube に問い合わせた回数として数える
    for (let i = 0; i < GUEST_DAILY_VIDEO_LIMIT; i++) {
      await expectVideoError(
        registerVideo(guest(ipHash), URL, fakeYouTube({ video: null, pages: [] })),
        "video_not_found",
      );
    }
    const youtube = fakeYouTube({ pages: [page("x", 1, null)] });
    await expectVideoError(registerVideo(guest(ipHash), URL, youtube), "guest_daily_limit");

    // 別のIPなら登録できる
    await registerVideo(guest(), URL, fakeYouTube({ pages: [page("y", 1, null)] }));
  });

  it("IP が分からない場合は、IP単位の上限をかけない", async () => {
    await registerVideo(guest(null), URL, fakeYouTube({ pages: [page("z", 1, null)] }));
  });
});

describe("ログインユーザーの残りのコメントの取得（要件定義書7.2）", () => {
  afterAll(cleanup);

  it("最初の100件で返し、残りを取得し終えたら fetch_status が done になる", async () => {
    const youtube = fakeYouTube({
      pages: [page("p1", 100, "T2"), page("p2", 100, "T3"), page("p3", 50, null)],
    });
    const { video, fetchRemaining } = await registerVideo(await user(), URL, youtube);

    expect(video.fetch_status).toBe("fetching");
    expect(await countComments(video.id)).toBe(100);

    await fetchRemaining!();

    const { data } = await admin.from("videos").select("fetch_status").eq("id", video.id).single();
    expect(data!.fetch_status).toBe("done");
    expect(await countComments(video.id)).toBe(250);
    expect(youtube.calls.map((c) => c.pageToken)).toEqual([undefined, "T2", "T3"]);
    expect((await usageOf(video.id)).filter((u) => u.endpoint === "commentThreads.list")).toHaveLength(3);
  });

  it("1000スレッドで取得をやめる", async () => {
    const pages = Array.from({ length: 12 }, (_, i) => page(`m${i}`, 100, `T${i + 1}`));
    const youtube = fakeYouTube({ pages });
    const { video, fetchRemaining } = await registerVideo(await user(), URL, youtube);
    await fetchRemaining!();

    expect(youtube.calls).toHaveLength(10);
    expect(await countComments(video.id)).toBe(1000);
  });

  it("途中で失敗したら failed になり、取得済みのコメントは残る", async () => {
    const youtube = fakeYouTube({ pages: [page("f1", 100, "T2"), "quota_exceeded"] });
    const { video, fetchRemaining } = await registerVideo(await user(), URL, youtube);
    await fetchRemaining!();

    const { data } = await admin.from("videos").select("fetch_status").eq("id", video.id).single();
    expect(data!.fetch_status).toBe("failed");
    expect(await countComments(video.id)).toBe(100);
    const usage = await usageOf(video.id);
    expect(usage.at(-1)).toMatchObject({ endpoint: "commentThreads.list", succeeded: false });
  });
});

describe("重複防止と本文変更の検知（要件定義書7.4）", () => {
  afterAll(cleanup);

  it("同じコメントが次のページにも出てきたら、本文が同じなら何もせず、変わっていれば更新する", async () => {
    const first = page("d", 100, "T2");
    const second = page("d", 2, null); // d-0 と d-1 が再び出てくる
    second.comments[1] = { ...second.comments[1], text: "編集された本文" }; // d-1 だけ本文が変わった
    const youtube = fakeYouTube({ pages: [first, second] });

    const { video, fetchRemaining } = await registerVideo(await user(), URL, youtube);
    const before = await admin
      .from("comments")
      .select("external_comment_id, updated_at, body_hash")
      .eq("video_id", video.id)
      .in("external_comment_id", ["d-0", "d-1"]);
    await fetchRemaining!();

    expect(await countComments(video.id)).toBe(100);
    const { data: after } = await admin
      .from("comments")
      .select("external_comment_id, updated_at, body_hash, comment_text")
      .eq("video_id", video.id)
      .in("external_comment_id", ["d-0", "d-1"]);
    const was = (id: string) => before.data!.find((c) => c.external_comment_id === id)!;
    const now = (id: string) => after!.find((c) => c.external_comment_id === id)!;

    expect(now("d-0").updated_at).toBe(was("d-0").updated_at);
    expect(now("d-1").comment_text).toBe("編集された本文");
    expect(now("d-1").body_hash).not.toBe(was("d-1").body_hash);
    expect(now("d-1").updated_at).not.toBe(was("d-1").updated_at);
  });
});
