-- =============================================================
-- 8テーブル（テーブル定義書 5章）と外部キーの ON DELETE（3章）
--
-- 作成順は、参照される側（親）が先。
--   users, sources → videos → comments → comment_groups → comment_analysis → advice_logs
-- ON DELETE CASCADE にしているのは、親の1行を消すだけで子データまで消えるようにするため
-- （期限切れ削除、ユーザーによる動画削除、アカウント削除。要件定義書13.4）。
-- =============================================================

-- -------------------------------------------------------------
-- users（ログインユーザー）
-- -------------------------------------------------------------
create table public.users (
  -- [Supabase固有] auth.users は Supabase Auth が管理するテーブル（ログイン情報の本体）。
  -- アプリ側のプロフィールは public.users に分けて持ち、id を共有する。
  -- auth.users の行が消えたら（アカウント削除）、プロフィールも消える。
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  -- 'user' または 'admin'（要件定義書13.2）
  role text not null default 'user',
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- sources（媒体情報。MVPは youtube のみ）
-- -------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text,
  api_notes text,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- videos（動画情報。所有者を持つのはこのテーブルだけ）
-- -------------------------------------------------------------
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,
  -- Cookie で発行した UUID。対応するテーブルがないので外部キーは持たない。
  guest_id uuid,
  -- 動画が残っている媒体は削除できないようにする（誤って媒体ごと消さないため）。
  source_id uuid not null references public.sources (id) on delete restrict,
  -- YouTube 側の動画ID。内部の id とは別物。
  video_id text not null,
  title text not null,
  -- URL のみ保存する（画像の保存は YouTube の規約で禁止。要件定義書6章）。
  thumbnail_url text,
  published_at timestamptz,
  -- 保持期間（ゲスト24時間、ログインユーザー29日）の起点。引継ぎや再分析でも変えない。
  created_at timestamptz not null default now(),

  -- 所有者は「ログインユーザー」か「ゲスト」のどちらか一方だけ。
  -- 両方 NULL（持ち主不明）や両方あり（どちらの保持期間か曖昧）を DB で拒否する。
  constraint videos_owner_exclusive check (
    (user_id is not null and guest_id is null)
    or (user_id is null and guest_id is not null)
  )
);

-- -------------------------------------------------------------
-- comments（コメント本体）
-- -------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  external_comment_id text,
  comment_text text not null,
  author text,
  like_count int,
  -- SHA-256(comment_text)。本文が変わったときだけ再分析するための判定に使う。
  body_hash text,
  -- 自己参照：NULL なら親コメント、値があれば返信（親コメントの内部 id）。
  -- 親コメントが消えたら返信も消す。
  parent_comment_id uuid references public.comments (id) on delete cascade,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  -- UPDATE 時はトリガーで自動更新する（次のマイグレーション）。
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- comment_groups（類似コメントのグループ）
-- comment_analysis.group_id から参照されるので、comment_analysis より先に作る。
-- -------------------------------------------------------------
create table public.comment_groups (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  group_type public.group_type not null,
  representative_text text not null,
  -- text-embedding-3-small の次元数は 1536。
  representative_embedding extensions.vector(1536) not null,
  comment_count integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- comment_analysis（AI分析結果。再分析の履歴を is_latest で管理）
-- -------------------------------------------------------------
create table public.comment_analysis (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  is_latest boolean not null default true,
  analyzed_at timestamptz not null,
  primary_category public.primary_category not null,
  -- 該当なしは NULL ではなく空配列（「未設定」と「該当なし」を区別しないため）。
  labels text[] not null default '{}',
  ng_words text[],
  score numeric(3, 2),
  review_required boolean,
  -- グループが消えても、分析結果そのものは残す（所属だけ外れる）。
  group_id uuid references public.comment_groups (id) on delete set null,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- ng_words（NGワード辞書。他テーブルとの外部キーなし）
-- -------------------------------------------------------------
create table public.ng_words (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  category text,
  severity int,
  normalized text,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- advice_logs（アドバイス生成履歴）
-- -------------------------------------------------------------
create table public.advice_logs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  advice_text text not null,
  advice_summary text not null,
  triggered_by public.triggered_by not null,
  model_version text,
  -- triggered_by = 'user' のときだけ使う（MVPでは常に NULL）。
  user_id uuid references public.users (id) on delete cascade,
  guest_id uuid,
  generated_at timestamptz not null,
  created_at timestamptz not null default now()
);
