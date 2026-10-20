"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { AuthFormState } from "./actions";

// ログインとサインアップで共通のフォーム。
// useActionState で Server Action の戻り値（エラーメッセージ）を受け取り、送信中はボタンを無効にする。
export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "signup";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isLogin = mode === "login";

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{isLogin ? "ログイン" : "無料で登録する"}</CardTitle>
          <CardDescription>
            ゲストとして分析した動画は、自動的にアカウントへ引き継がれます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                minLength={6}
                required
              />
            </div>
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            {state?.message && <p className="text-sm">{state.message}</p>}
            <Button type="submit" disabled={pending}>
              {isLogin ? "ログインする" : "登録する"}
            </Button>
            <Link
              href={isLogin ? "/signup" : "/login"}
              className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              {isLogin ? "アカウントを作成する" : "ログインはこちら"}
            </Link>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
