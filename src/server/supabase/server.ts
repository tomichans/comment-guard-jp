import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { serverEnv } from "@/server/env";

// =============================================================
// [Supabase固有] ログインユーザー用のクライアント（RLS が効く）
//
// anon キーに、Cookie に保存されたログイン情報（JWT）を添えて接続する。
// DB は JWT からユーザーを判定し（auth.uid()）、RLS のポリシーで許可された行だけを返す。
// ログインユーザーのデータは、このクライアントで読む（サーバー側の確認と RLS の二重の防御）。
//
// @supabase/ssr は、Supabase のログイン情報を Cookie に保存・更新するためのライブラリ。
// Next.js の cookies() と橋渡しするために、getAll / setAll を渡す。
// =============================================================

export async function createSessionClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    serverEnv.supabaseUrl,
    serverEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component から呼ばれた場合、Next.js の仕様で Cookie を書き込めず例外になる。
            // ログイン情報の更新は src/proxy.ts が毎リクエストで行っているので、ここでは無視してよい。
          }
        },
      },
    },
  );
}

export type SessionClient = Awaited<ReturnType<typeof createSessionClient>>;
