// 右の枠（要件定義書4.4）。
// ランキングはスライス4、AIアドバイスはスライス5で作る。それまでは「準備中」の枠だけを置く。
const SECTIONS = ["指摘・要望ランキング", "質問ランキング", "AIアドバイス"];

export function InsightsPane() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">インサイト</h2>
      {SECTIONS.map((title) => (
        <section key={title} className="rounded-lg border p-4">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">準備中です</p>
        </section>
      ))}
    </div>
  );
}
