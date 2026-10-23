import { describe, expect, it } from "vitest";

import { parseYouTubeVideoId } from "@/lib/youtube-url";

// 受け付けるURLの形式（要件定義書6章）
describe("YouTube の URL から動画IDを取り出す", () => {
  const id = "dQw4w9WgXcQ";

  it.each([
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=30s`,
    `https://m.youtube.com/watch?v=${id}`,
    `http://www.youtube.com/watch?list=PL123&v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
    `  https://youtu.be/${id}  `,
  ])("受け付ける：%s", (url) => {
    expect(parseYouTubeVideoId(url)).toBe(id);
  });

  it.each([
    "",
    "動画のURL",
    id, // URL ではなくIDだけ
    `https://www.youtube.com/channel/UC123`,
    `https://www.youtube.com/playlist?list=PL123`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/watch?v=short`, // 11文字でない
    `https://www.youtube.com/watch?v=${id}<script>`,
    `https://example.com/watch?v=${id}`,
    `https://youtube.com.evil.example/watch?v=${id}`,
    `javascript:alert(1)//youtu.be/${id}`,
    `ftp://youtu.be/${id}`,
  ])("受け付けない：%s", (url) => {
    expect(parseYouTubeVideoId(url)).toBeNull();
  });
});
