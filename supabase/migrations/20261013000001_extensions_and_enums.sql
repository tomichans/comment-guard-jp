-- =============================================================
-- 拡張機能と Enum 型
-- テーブル定義書 1章（共通事項）、4章（Enum・値の定義）
-- =============================================================

-- pgvector：Embedding（vector(1536)）を保存し、類似度を計算するための拡張。
-- グルーピング（要件定義書10章）で使う。列を作る前に有効化しておく必要がある。
-- [Supabase固有] Supabase では、拡張を public ではなく extensions スキーマに入れるのが慣例。
-- public に入れると、拡張の関数や型が API（PostgREST）のスキーマに混ざってしまうため。
create extension if not exists vector with schema extensions;

-- 値の種類が決まっている列は、text ではなく Enum 型にする。
-- 綴りの誤り（'questoin' など）を DB が拒否してくれるので、不正な値が混ざらない。
-- labels（複数値）は text[] のまま（テーブル定義書4.2）。Enum の配列は扱いが煩雑なため。

-- comment_analysis.primary_category（7種）
create type public.primary_category as enum (
  'question',
  'feedback',
  'praise',
  'negative_opinion',
  'harmful',
  'spam',
  'other'
);

-- comment_groups.group_type（どちらのランキングの対象か）
create type public.group_type as enum (
  'feedback_request',
  'question'
);

-- advice_logs.triggered_by（MVPでは常に 'system'）
create type public.triggered_by as enum (
  'system',
  'user'
);
