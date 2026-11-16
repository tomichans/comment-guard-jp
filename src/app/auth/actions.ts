"use server";

import { redirect } from "next/navigation";

import { PASSWORD_MIN_LENGTH } from "@/lib/config/auth";
import { takeOverGuestDataOnLogin } from "@/server/migrate-guest";
import { createSessionClient } from "@/server/supabase/server";

// =============================================================
// 認証の Server Actions（フォームから直接呼ばれるサーバー側の関数）
//
// 認証方式は、メールアドレスとパスワード（要件定義書3.2で確定。メール確認なし）。
// =============================================================

export type AuthFormState = { error?: string; message?: string } | undefined;

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password } = readCredentials(formData);
  const supabase = await createSessionClient();

  // [Supabase固有] Supabase Auth にメールとパスワードを送り、成功するとログイン情報が Cookie に保存される。
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    // メールアドレスが未登録か、パスワードが違うかを区別して返すと、登録済みのメールアドレスを探られてしまう。
    return { error: "メールアドレスまたはパスワードが正しくありません" };
  }

  await takeOverGuestDataOnLogin(data.user.id);
  redirect("/");
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password } = readCredentials(formData);
  // 画面の minLength はブラウザの開発ツールで外せるので、サーバーでも確かめる。
  // Supabase 側も同じ最低文字数で拒否するが、ここで先に確かめると、理由の分かるメッセージを出せる。
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { error: `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください` };
  }
  const supabase = await createSessionClient();

  // [Supabase固有] auth.users に行が作られ、DBトリガーで public.users も作られる
  // （supabase/migrations/20261013000005_sync_auth_users.sql）。
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    return { error: "登録できませんでした。入力内容を確認してください" };
  }

  // [Supabase固有] メール確認が有効な設定では、確認が済むまで session が null（＝まだログインしていない）。
  // 引継ぎは「ログインが成立したとき」に行うので、その場合は確認後の最初のログインで引継ぐ。
  if (!data.session) {
    return { message: "確認メールを送信しました。メール内のリンクから登録を完了してください" };
  }

  await takeOverGuestDataOnLogin(data.user.id);
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  // [Supabase固有] ログイン情報の Cookie を削除する。
  await supabase.auth.signOut();
  redirect("/");
}
