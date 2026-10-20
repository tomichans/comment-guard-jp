import "server-only";

import type { Owner } from "@/server/access";
import { readGuestId } from "@/server/guest";
import { createSessionClient } from "@/server/supabase/server";

/**
 * 今のリクエストの持ち主を判定する。
 *   - ログインしていれば、ログインユーザー（ゲストの Cookie が残っていてもユーザーを優先する）
 *   - ログインしておらず、有効な guest_id の Cookie があれば、ゲスト
 *   - どちらでもなければ null（まだ何も作っていない初回訪問者）
 */
export async function getRequestOwner(): Promise<Owner | null> {
  const client = await createSessionClient();
  // [Supabase固有] getUser() は Supabase Auth のサーバーに問い合わせて、トークンが本物かを検証する。
  // Cookie の中身をそのまま信じる getSession() は、改ざんされた Cookie でも通ってしまうので使わない。
  const {
    data: { user },
  } = await client.auth.getUser();
  if (user) return { kind: "user", userId: user.id, client };

  const guestId = await readGuestId();
  if (guestId) return { kind: "guest", guestId };

  return null;
}
