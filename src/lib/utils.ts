import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui の標準ヘルパー。条件付きのクラス名を結合し、
// Tailwind のクラスが衝突したとき（例：p-2 と p-4）は後勝ちにする。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
