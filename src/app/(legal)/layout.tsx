import Link from "next/link";

import { SiteHeader } from "@/components/site/site-header";

// 利用規約・プライバシーポリシーの共通の枠（要件定義書18.3）。
// 3ペインの枠（(app)/layout.tsx）の外に置き、ログインしていなくても読める普通のページにする。
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
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
