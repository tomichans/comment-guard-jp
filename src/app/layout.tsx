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
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
