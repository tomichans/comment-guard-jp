# CommentGuard JP

YouTubeコメントをAIで分析し、発信者がコメントを安全かつ効率的に閲覧できるよう支援する、日本語特化型のWebアプリ。

- 要件：[docs/requirements.md](docs/requirements.md)
- テーブル定義：[docs/table-definition.md](docs/table-definition.md)

## コードの読み方：`[Supabase固有]` の印

このプロジェクトは、一般的なWeb開発の学習を目的にしている。
一般的な知識（Next.js、HTTP、Cookie、SQL、PostgreSQL など）と、Supabase 固有の知識を区別できるよう、
**Supabase 固有の仕組みに依存するコードには、コメントに `[Supabase固有]` と書いている。**

```
grep -rn "Supabase固有" src supabase tests
```

`[Supabase固有]` の主な例：

| 仕組み | 一般的な技術で言い換えると |
| --- | --- |
| anon キー / service role キー | 「権限の弱い公開用の鍵」と「全権限の管理用の鍵」 |
| RLS の `auth.uid()`、`to authenticated` | PostgreSQL の RLS（これ自体は標準機能）に、ログイン中のユーザーIDを渡す Supabase の仕組み |
| `auth.users` テーブル | Supabase Auth が管理するユーザー表。アプリのプロフィール表（`public.users`）とは別 |
| `@supabase/ssr` | ログイン情報（JWT）を Cookie に保存・更新するライブラリ |
| `supabase` CLI（`supabase start` など） | ローカルで DB と認証サーバーを起動する開発ツール |

印のない部分（例：`CHECK` 制約、部分ユニークインデックス、`ON DELETE CASCADE`、トリガー、httpOnly Cookie、
Server Actions）は、Supabase 以外の PostgreSQL や Next.js でもそのまま通用する。

## ローカルでの起動

前提：Node.js 22、Docker（Supabase CLI が内部で使う）

```bash
npm install

# ローカルの Supabase（Postgres・認証サーバー）を起動する。初回はイメージの取得に時間がかかる。
# 起動時に supabase/migrations/ と supabase/seed.sql が適用される。
npm run db:start

# 表示された URL とキーを .env.local に書く（.env.example をコピーして埋める）
npx supabase status
cp .env.example .env.local

npm run dev   # http://localhost:3000
```

## テスト

ローカルの Supabase が起動している状態で実行する（CI は使わない）。

```bash
npm test
```

DB を作り直したいとき（マイグレーションを追加したときなど）：

```bash
npm run db:reset   # マイグレーションと seed を最初から適用し直す（データは消える）
npm run db:types   # DB の型定義 src/lib/database.types.ts を再生成する
```

## ディレクトリ構成

```
src/
  app/                 画面と API Route（Next.js App Router）
  lib/                 ブラウザとサーバーの両方で使えるもの（保持期間の定数、DB の型など）
  server/              サーバー専用（先頭で import "server-only"。ブラウザから import するとビルドエラー）
    access.ts          ★ 所有確認と期限判定の共通関数。API Route は必ずここを通す
  proxy.ts             Next.js 16 の proxy（旧 middleware）。Supabase のトークン更新のみ
supabase/
  migrations/          DB のマイグレーション
  seed.sql             初期データ
tests/                 Vitest
```
