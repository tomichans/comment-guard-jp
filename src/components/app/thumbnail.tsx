import { cn } from "@/lib/utils";

// 動画のサムネイル。
// YouTube の規約で画像の保存は禁止されているため（要件定義書6章）、YouTube の URL をそのまま表示する。
// Next.js の <Image> は、画像を自分のサーバーで縮小して保存（キャッシュ）するので、使わずに <img> にしている。
export function Thumbnail({ url, className }: { url: string | null; className?: string }) {
  return (
    <div className={cn("aspect-video shrink-0 overflow-hidden rounded-md bg-muted", className)}>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- 上の理由で <Image> を使わない
        <img src={url} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
      )}
    </div>
  );
}
