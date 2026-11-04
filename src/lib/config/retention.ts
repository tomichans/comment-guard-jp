// =============================================================
// データ保持期間（要件定義書3.3）
//
// YouTube API Services の規約で、API から取得したデータは30日以内に削除または更新する必要がある。
// ログインユーザーを30日ではなく29日にしているのは、削除ジョブの実行間隔（1時間）や遅延で
// 30日を超えてしまうのを避けるため。
//
// 期限の判定はこのファイルの関数だけで行う。読み取り時の判定（src/server/access.ts）と
// 削除ジョブ（src/server/purge-expired.ts）が同じ関数を使うので、両者の判定がずれない。
// 画面の案内文（「24時間で自動的に削除されます」など）もこの定数から表示する。
// =============================================================

/** ゲストの動画の保持期間（時間） */
export const GUEST_RETENTION_HOURS = 24;

/** ログインユーザーの動画の保持期間（日） */
export const USER_RETENTION_DAYS = 29;

/**
 * API使用量の記録（api_usage_logs）の保持期間（日）【確定】（要件定義書17.2）。
 * YouTube のデータではないので、動画とは別の期間。利用上限の判定には直近24時間しか使わないが、
 * 費用の振り返りに使えるよう、少し長めに残す。
 */
export const USAGE_LOG_RETENTION_DAYS = 90;

const HOUR_MS = 60 * 60 * 1000;

export type OwnerKind = "user" | "guest";

/** 所有者の種類ごとの保持期間（ミリ秒） */
export function retentionMs(kind: OwnerKind): number {
  return kind === "guest"
    ? GUEST_RETENTION_HOURS * HOUR_MS
    : USER_RETENTION_DAYS * 24 * HOUR_MS;
}

/**
 * これより前に作られた動画は期限切れ、という境界の時刻。
 * 削除ジョブでは「created_at < この時刻」を削除条件に使う。
 */
export function expiryCutoff(kind: OwnerKind, now: Date = new Date()): Date {
  return new Date(now.getTime() - retentionMs(kind));
}

/**
 * 動画が期限切れかどうか。
 * 「保持期間を超えたら」削除なので、ちょうど保持期間ぴったりの時点はまだ期限内とする。
 *
 * 種類は videos の列から決まる：guest_id があればゲストの期間、user_id があればユーザーの期間。
 * ゲストからログインへ引継いだ動画は user_id に変わるので、自動的にユーザーの期間が適用される
 * （created_at は変えないので、起点は元のまま）。
 */
export function isExpired(
  video: { created_at: string; user_id: string | null },
  now: Date = new Date(),
): boolean {
  const kind: OwnerKind = video.user_id ? "user" : "guest";
  return new Date(video.created_at).getTime() < expiryCutoff(kind, now).getTime();
}
