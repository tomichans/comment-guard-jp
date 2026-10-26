import { AppShell, type Viewer } from "@/components/app/app-shell";
import { createSessionClient } from "@/server/supabase/server";

// メイン画面の共通の枠（要件定義書4.1）：左＝動画一覧、中央＝ページの中身、右＝インサイト。
// トップ（/）と動画のページ（/videos/:id）は、この枠の中央だけが入れ替わる。
//
// ここ（サーバー）で決めるのは「ログインしているか」だけ。
// 動画やコメントのデータは、画面（ブラウザ）から API Route を呼んで読む
// （ゲストのデータは API Route 経由でのみ扱う。要件定義書16章）。
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const viewer: Viewer = user
    ? { kind: "user", userId: user.id, email: user.email ?? "" }
    : { kind: "guest" };

  return <AppShell viewer={viewer}>{children}</AppShell>;
}
