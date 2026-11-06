import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// npm test は tests/ の自動テスト、npm run eval（--mode eval）は eval/ のコメント分類の評価を実行する。
// 評価は本物の AI を呼ぶ（費用がかかり、結果も毎回少し変わる）ので、npm test には含めない。
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only は「React のサーバー環境以外で import されたら例外を投げる」パッケージ。
      // Vitest はそのどちらでもないので、テストのときだけ空のモジュールに差し替える。
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // .env.local（ローカルの Supabase の URL とキー）を process.env に読み込む。
    env: loadEnv("test", process.cwd(), ""),
    // すべてのテストファイルが同じローカル DB を使う。
    // 削除ジョブのテストは DB 全体の期限切れ動画を消すので、ファイルを並列に実行すると他のテストのデータに干渉する。
    fileParallelism: false,
    hookTimeout: 30_000,
    ...(mode === "eval"
      ? // AI の呼び出し（やり直しを含む）を待てるよう、長めにする。
        { include: ["eval/**/*.eval.ts"], testTimeout: 10 * 60 * 1000 }
      : { include: ["tests/**/*.test.ts"], testTimeout: 30_000 }),
  },
}));
