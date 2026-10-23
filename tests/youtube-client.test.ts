import { describe, expect, it } from "vitest";

import { errorCodeFor, toCommentThreadPage } from "@/server/youtube/client";

// YouTube API の応答を、アプリで使う形に変換する部分（要件定義書7.3、15.1）
describe("YouTube API の応答の変換", () => {
  it("親コメントの後に、同梱された返信が並ぶ", () => {
    const result = toCommentThreadPage({
      nextPageToken: "NEXT",
      items: [
        {
          snippet: {
            topLevelComment: {
              id: "p1",
              snippet: { textDisplay: "親", authorDisplayName: "A", likeCount: 3, publishedAt: "2026-10-01T00:00:00Z" },
            },
          },
          replies: { comments: [{ id: "p1.r1", snippet: { textDisplay: "返信", parentId: "p1" } }] },
        },
        { snippet: { topLevelComment: { id: "p2", snippet: { textDisplay: "親2" } } } },
      ],
    });

    expect(result.threadCount).toBe(2);
    expect(result.nextPageToken).toBe("NEXT");
    expect(result.comments.map((c) => [c.externalId, c.parentExternalId])).toEqual([
      ["p1", null],
      ["p1.r1", "p1"],
      ["p2", null],
    ]);
    expect(result.comments[0]).toMatchObject({ text: "親", author: "A", likeCount: 3 });
  });

  it("最後のページは nextPageToken が null", () => {
    expect(toCommentThreadPage({}).nextPageToken).toBeNull();
  });

  it.each([
    [403, "commentsDisabled", "comments_disabled"],
    [403, "quotaExceeded", "quota_exceeded"],
    [403, "dailyLimitExceeded", "quota_exceeded"],
    [404, "videoNotFound", "video_not_found"],
    [500, "backendError", "youtube_error"],
    [400, undefined, "youtube_error"],
  ] as const)("HTTP %i（%s）は %s", (status, reason, code) => {
    expect(errorCodeFor(status, reason)).toBe(code);
  });
});
