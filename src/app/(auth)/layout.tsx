import { SiteHeader } from "@/components/site/site-header";

// ログイン・サインアップの共通の枠。
// 利用規約などのページ（(legal)/layout.tsx）と同じ見出しを出し、トップ（/）に戻れるようにする。
// ( ) で囲んだフォルダはURLに含まれないので、URLは /login、/signup のまま変わらない。
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      {children}
    </div>
  );
}
