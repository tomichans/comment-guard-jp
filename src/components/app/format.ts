// 日時の表示（日本時間）。
const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
