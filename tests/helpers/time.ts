// =============================================================
// 時刻の計算のヘルパー（DB を使わないので、どのテストからでも読み込める）
// =============================================================

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** now から ms ミリ秒前の時刻（DB に入れる文字列の形）。例：ago(25 * HOUR_MS) は25時間前。 */
export function ago(ms: number, now: Date = new Date()): string {
  return new Date(now.getTime() - ms).toISOString();
}
