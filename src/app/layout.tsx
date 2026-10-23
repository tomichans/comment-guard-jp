import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

// shadcn/ui（Nova プリセット）の標準フォント。英数字は Geist、日本語はブラウザの既定フォントで表示される。
// next/font は、ビルド時に Google Fonts からフォントを取得して自サイトから配信する（実行時に Google へは通信しない）。
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "CommentGuard JP",
  description: "YouTubeコメントをAIで分析し、安全かつ効率的な閲覧を支援する",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={cn("h-full antialiased", "font-sans", geist.variable)}>
      <body className="min-h-full flex flex-col font-sans">
        {/* MVPはPCブラウザ専用（画面幅1280px以上。要件定義書1.5）。xl は Tailwind の 1280px 以上。 */}
        <div className="hidden flex-1 flex-col xl:flex">{children}</div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center xl:hidden">
          <p className="font-semibold">CommentGuard JP は、PCのブラウザ専用です</p>
          <p className="text-sm text-muted-foreground">
            画面の幅が1280px以上で開いてください（ウィンドウを広げると表示されます）。
          </p>
        </div>
      </body>
    </html>
  );
}
