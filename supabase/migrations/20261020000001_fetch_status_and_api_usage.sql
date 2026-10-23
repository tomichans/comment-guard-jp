-- =============================================================
-- スライス2：コメント取得の状況と、API使用量の記録（テーブル定義書 5.1、5.9）
--
-- 【確定】videos.fetch_status：コメント取得の状況（取得中／完了／失敗）を画面に出すため。
-- 【確定】api_usage_logs：YouTube と AI の API を、いつ・誰が・どれだけ使ったかを記録する9つ目のテーブル。
--   ログ出力ではなく DB にしたのは、「使いすぎたら止める」（要件定義書14.2）や
--   ゲストの1日あたりの上限（要件定義書3.1）で、回数を数える必要があるため。
-- =============================================================

-- -------------------------------------------------------------
-- videos.fetch_status
-- -------------------------------------------------------------
create type public.fetch_status as enum (
  'fetching',
  'done',
  'failed'
);

-- 既存の行（スライス1のテストデータなど）は「完了」として扱う。
-- 新しく作る動画は、アプリが作成時に fetching か done を明示的に入れる。
alter table public.videos
  add column fetch_status public.fetch_status not null default 'done';

-- -------------------------------------------------------------
-- api_usage_logs（API使用量の記録）
-- -------------------------------------------------------------
create table public.api_usage_logs (
  id uuid primary key default gen_random_uuid(),
  -- 'youtube'（スライス2）。AI（'openai' など）はスライス3以降で記録する。
  service text not null,
  -- 呼んだ API（例：'videos.list'、'commentThreads.list'）
  endpoint text not null,
  -- YouTube API のクォータ消費量（videos.list、commentThreads.list は1回1）
  units integer,
  -- AI 用（スライス3以降）：モデル名、入出力トークン数、推定費用
  model text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12, 6),
  succeeded boolean not null,
  duration_ms integer,
  -- 外部キーを付けない：動画が削除（期限切れ・ユーザー削除）されても、使用量の記録は残すため。
  -- 動画の作成前に呼んだ API（動画情報の取得など）も、作成予定の id で記録できる。
  video_id uuid,
  -- アカウントが削除されたら、記録は残して user_id だけ外す。
  user_id uuid references public.users (id) on delete set null,
  guest_id uuid,
  -- ゲストのIPアドレスを、秘密の鍵で変換（HMAC-SHA256）した値。IPそのものは保存しない。
  -- ゲストの1日あたりの上限の判定にだけ使う。ログインユーザーの記録では NULL。
  ip_hash text,
  created_at timestamptz not null default now()
);

-- ゲストの1日あたりの上限：「この ip_hash で、直近24時間に何回呼んだか」を数えるため。
create index idx_api_usage_logs_ip_hash_created_at
  on public.api_usage_logs (ip_hash, created_at)
  where ip_hash is not null;

-- FK列のインデックス（テーブル定義書6.2）
create index idx_api_usage_logs_user_id on public.api_usage_logs (user_id);

-- ポリシーなし＝サーバー専用（ブラウザからは一切見えない）。
alter table public.api_usage_logs enable row level security;
