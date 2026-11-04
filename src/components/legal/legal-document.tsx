import { LEGAL_UPDATED_AT } from "@/lib/config/site";

// 利用規約・プライバシーポリシーの見た目をそろえるための部品。
// 文章はページ側（src/app/(legal)/）に、ふつうの JSX で書く。

export function LegalDocument({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="flex flex-col gap-8 leading-relaxed">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">制定日：{LEGAL_UPDATED_AT}</p>
      </header>
      {children}
    </article>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="flex list-disc flex-col gap-1 pl-6">{children}</ul>;
}

/** 外部サイトへのリンク（新しいタブで開く） */
export function ExternalLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-4">
      {children ?? href}
    </a>
  );
}
