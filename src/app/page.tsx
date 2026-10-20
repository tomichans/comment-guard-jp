import Link from "next/link";

import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { createSessionClient } from "@/server/supabase/server";

// 仮のトップページ。本格的な3ペインの画面は後のスライスで作る。
// 今はログイン状態の確認と、ログイン／サインアップ画面への導線だけを置いている。
export default async function Home() {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold">CommentGuard JP</h1>
      {user ? (
        <div className="flex items-center gap-4">
          <p className="text-sm">{user.email} でログイン中</p>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              ログアウト
            </Button>
          </form>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <Button asChild>
            <Link href="/signup">無料で登録する</Link>
          </Button>
          <Button asChild variant="link">
            <Link href="/login">ログインする</Link>
          </Button>
        </div>
      )}
    </main>
  );
}
