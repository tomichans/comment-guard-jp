import Link from "next/link";

// 3ペインの枠の外にあるページ（利用規約・プライバシーポリシー、ログイン・サインアップ）で共通の見出し。
// アプリ名とリンクから、いつでもトップ（/）に戻れるようにする。
export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold">
          CommentGuard JP
        </Link>
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          アプリに戻る
        </Link>
      </div>
    </header>
  );
}
