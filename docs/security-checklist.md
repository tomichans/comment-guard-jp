# セキュリティの点検手順

デプロイの前と、公開した後に定期的（月に1回くらい）行う点検です（要件定義書16章）。
どれもコードは変えず、確認と設定だけです。

## 1. デプロイの前

### 1.1 ライブラリの既知の弱点を調べる（`npm audit`）

```bash
npm audit --omit=dev
```

- `--omit=dev` は、テストや lint のための道具を除いて、アプリの実行に使うライブラリだけを調べる指定。
- **critical（重大）・high（高）** が出たら、デプロイの前に直す。`npm audit fix` で直るものは、それを使う。
- `npm audit fix --force` は使わない。大きな版の更新（壊れる変更）も勝手に入るため。版を指定して更新する（Next.js を 16.2.0 から 16.4.3 にしたときと同じ。要件定義書19章）。
- `--omit=dev` でも、shadcn の CLI（`dependencies` に入っている）の中の弱点が出ることがある。`shadcn` は部品を追加する道具で、`globals.css` が読み込むのは CSS だけ。サーバーでは動かず、外から渡されたデータも通らない。そのため、これらの high は「アプリの実行に関係しない」ものとして扱う（2026-11-18 に `picomatch` の ReDoS で確認。公開されている最新版も対象で、直った版がまだなく、`npm audit fix` では直らない。直った版が出たら更新する）。
- 「実行に関係するか」は、①サーバーやブラウザで動くか、②外から受け取るデータが通るか、の2点で判断する。
- moderate（中）・low（低）は、どのライブラリの、どの使い方の弱点かを読んで決める。開発用の道具（shadcn の CLI など）の中だけの弱点で、アプリの実行に関係しなければ、急がなくてよい。

### 1.2 秘密のキーの置き場所を確かめる

- `.env.local` が Git に入っていないこと（`git status` に出ない。`.gitignore` で除外している）。
- Vercel の環境変数に、`.env.example` のすべての値を入れたこと。
- `NEXT_PUBLIC_` が付いているのは、Supabase の URL と anon キーの2つだけであること（`NEXT_PUBLIC_` の値はブラウザに渡るため）。
- `CRON_SECRET` と `IP_HASH_SECRET` は、ローカルと別の、新しいランダムな値にする（`openssl rand -hex 32`）。

### 1.3 本番の Supabase の設定

- Authentication → Sign In / Providers → Email
  - 「Confirm email」を無効にする（要件定義書3.2）
  - 「Minimum password length」を **8** にする（ローカルの `supabase/config.toml` と同じ）
- Advisors → **Security Advisor** を開き、警告がないことを確かめる。
  - RLS が無効なテーブルや、誰でも実行できる関数がないかを、Supabase が自動で調べてくれる。

### 1.4 GitHub の設定

- リポジトリの Settings → Advanced Security（または Code security）で、**Dependabot alerts** を有効にする。
  - 使っているライブラリに弱点が見つかると、GitHub がメールで知らせてくれる（自動で PR を作る機能は有効にしなくてよい）。
- **Secret scanning**（公開リポジトリでは既定で有効）が有効なことを確かめる。キーを誤ってコミットしたときに知らせてくれる。

## 2. デプロイした後

### 2.1 セキュリティ用のヘッダーが付いているか

```bash
curl -sI https://（公開URL）/ | grep -iE "content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|strict-transport-security|x-powered-by"
```

- `x-powered-by` 以外の6つが出て、`x-powered-by` が出なければよい（`next.config.ts`）。

### 2.2 ゲストのデータが外から読めないか

ゲストとして動画を1本分析したあと、ブラウザに公開されている anon キーで、Supabase の REST API を直接呼んでみる。

```bash
curl -s "https://（SupabaseのプロジェクトURL）/rest/v1/videos?select=id" \
  -H "apikey: （anon キー）"
```

- `[]`（空）が返ればよい。ゲストのデータには RLS のポリシーがないので、anon キーでは何も見えない（要件定義書16章）。
- 自動テスト `tests/access-guest.test.ts` の「anon キーで直接読んでも、ゲストのデータは見えない」と同じ確認を、本番で1回だけ行う。

### 2.3 OpenAI の利用額の上限

- OpenAI の Billing で、月の利用額の上限を設定する（要件定義書14.2の最後の歯止め）。

## 3. 定期的に（月に1回くらい）

- `npm audit --omit=dev` と、GitHub の Dependabot alerts を見る。critical・high があれば、更新して PR を作る。
- Supabase の Security Advisor を見る（マイグレーションを足したあとは必ず）。
- `api_usage_logs` で、1日の登録回数や AI の費用に、急な増え方がないかを見る。
