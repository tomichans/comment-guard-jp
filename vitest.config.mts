import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
