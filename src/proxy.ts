import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// =============================================================
// Next.js 16 の proxy（旧 middleware）。すべてのリクエストの前に実行される。
//
// [Supabase固有] ここでやっているのは、Supabase のログイン情報（アクセストークン）の更新だけ。
// アクセストークンは短時間で期限が切れるので、期限が近ければリフレッシュトークンで更新し、
// 新しいトークンを Cookie に書き戻す。Server Component では Cookie を書き込めないため、
// この処理は proxy で行う必要がある（@supabase/ssr の公式の構成）。
//
// アクセス制御（誰のデータを見せるか）はここでは行わない。
// それは API Route の中で src/server/access.ts が行う（1か所にまとめるため）。
// =============================================================

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // proxy は src/server/ を import しない（Next.js は proxy を独立して実行するため、共有モジュールに頼らない）。
  // NEXT_PUBLIC_ の2つは公開してよい値なので、ここで直接読む。
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // 更新後の Cookie を、後続の処理（リクエスト）とブラウザ（レスポンス）の両方に反映する。
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // [Supabase固有] getUser() を呼ぶと、必要に応じてトークンが更新され、上の setAll が呼ばれる。
  // getSession() は Cookie の中身を検証せずに信じるため、サーバー側では getUser() を使う。
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // 静的ファイルや画像には、ログイン情報の更新は不要なので除外する。
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
