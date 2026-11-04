import "server-only";

import { DEFAULT_ADVICE_MODEL, DEFAULT_CLASSIFY_MODEL } from "@/lib/config/analysis";

// =============================================================
// サーバー専用の環境変数
//
// 先頭の import "server-only" により、このファイルを（間接的にでも）ブラウザ用のコードから
// import するとビルドエラーになる。秘密のキーが誤ってブラウザ向けの JS に含まれるのを防ぐため。
// src/server/ 以下のファイルはすべて同じ行を先頭に書いている。
// =============================================================

function required(name: string): string {
  const value = process.env[name];
  // 未設定のまま動くと、原因の分かりにくいエラー（401 など）になるので、起動直後に明示的に落とす。
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません（.env.example を参照）`);
  }
  return value;
}

export const serverEnv = {
  // [Supabase固有] プロジェクトのURLと、2種類のキー（anon / service role）。
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  // YouTube Data API v3 の APIキー（Google Cloud で発行する）。
  get youtubeApiKey() {
    return required("YOUTUBE_API_KEY");
  },
  // ゲストのIPアドレスを変換（HMAC）するための秘密の鍵。src/server/ip.ts を参照。
  get ipHashSecret() {
    return required("IP_HASH_SECRET");
  },
  // OpenAI の APIキー。コメントの分類（AI）と NG判定（Moderation API）に使う。
  get openaiApiKey() {
    return required("OPENAI_API_KEY");
  },
  // 分類に使うモデル名。未設定なら src/lib/config/analysis.ts の既定のモデルを使う。
  get openaiClassifyModel() {
    return process.env.OPENAI_CLASSIFY_MODEL || DEFAULT_CLASSIFY_MODEL;
  },
  // AIアドバイスに使うモデル名。未設定なら src/lib/config/analysis.ts の既定のモデルを使う。
  get openaiAdviceModel() {
    return process.env.OPENAI_ADVICE_MODEL || DEFAULT_ADVICE_MODEL;
  },
};
