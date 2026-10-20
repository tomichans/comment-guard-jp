// shadcn/ui のクラス名ヘルパー。条件付きのクラス名を結合し、
// Tailwind のクラスが衝突したとき（例：p-2 と p-4）は後勝ちにする。
// 実体は shadcn 公式の `cn` パッケージ（clsx + tailwind-merge の置き換え）。
// shadcn CLI の init が生成する形のまま、components.json の utils エイリアスから参照できるようにしている。
export { cn } from "cn"
