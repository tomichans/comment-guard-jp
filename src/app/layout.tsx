import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
