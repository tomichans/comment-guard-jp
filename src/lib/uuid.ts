// URL のパラメータや Cookie など、外から来た値は UUID の形式か先に確かめる。
// DB の uuid 列に不正な文字列を渡すと、「見つからない」ではなく DB エラーになってしまうため。
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
