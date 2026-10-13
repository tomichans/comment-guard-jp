"use server";

import { redirect } from "next/navigation";

import { takeOverGuestDataOnLogin } from "@/server/migrate-guest";
import { createSessionClient } from "@/server/supabase/server";

// =============================================================
// 認証の Server Actions（フォームから直接呼ばれるサーバー側の関数）
//
// TODO(未決定): 認証方式（要件定義書3.2）。仮置きとして、メールアドレスとパスワードにしている。
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
