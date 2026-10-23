// =============================================================
// YouTube 動画URLの検証と、動画IDの取り出し（要件定義書6章）
//
// 受け付ける形式【確定】
//   https://www.youtube.com/watch?v=ID   （www なし、m.youtube.com も可）
//   https://youtu.be/ID
//   https://www.youtube.com/shorts/ID
//   https://www.youtube.com/live/ID
// それ以外（チャンネル、再生リスト、埋め込み、他サイトなど）はエラーにする。
//
// 動画IDは英数字・「-」・「_」の11文字（YouTube の動画IDの形式）。
// 形式を確かめておけば、不正な文字列を YouTube API に送らずに済む。
// =============================================================

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/** URL から YouTube の動画IDを取り出す。受け付けない形式なら null。 */
export function parseYouTubeVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  let id: string | null = null;
  if (url.hostname === "youtu.be") {
    // youtu.be/ID
    id = url.pathname.split("/")[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") {
      id = url.searchParams.get("v");
    } else if (first === "shorts" || first === "live") {
      id = second ?? null;
    }
  }

  return id && VIDEO_ID_PATTERN.test(id) ? id : null;
}
