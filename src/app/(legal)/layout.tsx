import Link from "next/link";

// 利用規約・プライバシーポリシーの共通の枠（要件定義書18.3）。
// 3ペインの枠（(app)/layout.tsx）の外に置き、ログインしていなくても読める普通のページにする。
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
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
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">{children}</main>
      <footer className="border-t">
        <nav className="mx-auto flex max-w-3xl gap-6 px-6 py-4 text-sm text-muted-foreground">
          <Link href="/terms" className="underline-offset-4 hover:underline">
            利用規約
          </Link>
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            プライバシーポリシー
          </Link>
        </nav>
      </footer>
    </div>
  );
}
