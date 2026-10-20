import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { serverEnv } from "@/server/env";

// =============================================================
// [Supabase固有] service role クライアント
//
// service role キーで接続すると、RLS がすべて無視される（DB の管理者に近い権限）。
// ゲストのデータには RLS のポリシーがない（要件定義書16章）ため、ゲストのデータを読むにはこのクライアントが必要。
// 逆に言えば、このクライアントで読むときは「誰のデータか」を自分のコードで必ず絞り込まなければならない。
// そのため、API Route から直接使わず、所有確認をまとめた src/server/access.ts を通す。
// =============================================================

export function createAdminClient() {
  return createClient<Database>(
    serverEnv.supabaseUrl,
    serverEnv.supabaseServiceRoleKey,
    {
      auth: {
        // [Supabase固有] サーバー側の使い捨てクライアントなので、ログイン状態の保存や自動更新はしない。
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export type AdminClient = ReturnType<typeof createAdminClient>;
