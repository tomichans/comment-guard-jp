-- =============================================================
-- Row Level Security（要件定義書16章）
--
-- [Supabase固有] なぜ全テーブルで RLS を有効にするのか
--   Supabase は、テーブルを自動で REST API（PostgREST）として公開する。
--   ブラウザには anon キーが渡るので、RLS が無効なテーブルは、誰でも API 経由で全行を読み書きできてしまう。
--   RLS を有効にすると「ポリシーで許可した行だけ」が見えるようになり、ポリシーがなければ何も見えない。
--
-- 方針
--   - ログインユーザーのデータ：ポリシーで「自分の行だけ読める」ようにする。
--   - ゲストのデータ：ポリシーを作らない。そのため anon キーからは一切見えず、
--     RLS を無視できる service role キーを使うサーバー（API Route）経由でしか読めない。
--     アクセス制御はサーバー側のコード（src/server/access.ts）で行う。
--   - 書き込み（INSERT / UPDATE）のポリシーは作らない。書き込みはすべてサーバーが service role で行う。
--     例：users.role をユーザー自身が 'admin' に書き換える、といったことを防ぐため。
--   - 期限切れ（要件定義書3.3）の判定は、ポリシーではなくサーバー側で行う。
--     保持期間を TypeScript の定数1か所で管理するため（ここに 24 や 29 を書くと二重管理になる）。
-- =============================================================

alter table public.users enable row level security;
alter table public.sources enable row level security;
alter table public.videos enable row level security;
alter table public.comments enable row level security;
alter table public.comment_groups enable row level security;
alter table public.comment_analysis enable row level security;
alter table public.ng_words enable row level security;
alter table public.advice_logs enable row level security;

-- sources と ng_words はポリシーなし＝サーバー専用。
-- 特に ng_words は、ブラウザから見えると判定をすり抜ける語を探されてしまうため公開しない。

-- 補足（書き方の決まりごと）
-- [Supabase固有] auth.uid() は、リクエストに付いている JWT（ログイン情報）からユーザーIDを取り出す関数。
--   未ログイン（anon）なら NULL になるため、「auth.uid() = user_id」はゲストの行（user_id が NULL）に一致しない。
-- [Supabase固有] `to authenticated` は「ログイン済みのロールにだけ適用する」という指定。
--   Supabase は JWT の内容に応じて、anon / authenticated のどちらかの DB ロールでクエリを実行する。
-- [Supabase固有] auth.uid() を (select auth.uid()) と書くのは、Supabase 推奨の高速化。
--   こう書くと、行ごとに関数を呼ばず、クエリ1回につき1回だけ評価される。

-- -------------------------------------------------------------
-- users：自分のプロフィールだけ読める
-- -------------------------------------------------------------
create policy "users_select_own"
  on public.users for select
  to authenticated
  using ((select auth.uid()) = id);

-- -------------------------------------------------------------
-- videos：自分の動画だけ読める・削除できる
-- 削除は要件定義書18.2（ログインユーザーは自分の動画を削除できる）のため。
-- -------------------------------------------------------------
create policy "videos_select_own"
  on public.videos for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "videos_delete_own"
  on public.videos for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- -------------------------------------------------------------
-- 子テーブル：所有者の列を持たないので、video_id から videos を辿って所有を確認する
-- （所有者を videos だけに持たせる正規化設計。要件定義書13.2）。
-- -------------------------------------------------------------
create policy "comments_select_own"
  on public.comments for select
  to authenticated
  using (
    exists (
      select 1 from public.videos v
      where v.id = comments.video_id
        and v.user_id = (select auth.uid())
    )
  );

create policy "comment_groups_select_own"
  on public.comment_groups for select
  to authenticated
  using (
    exists (
      select 1 from public.videos v
      where v.id = comment_groups.video_id
        and v.user_id = (select auth.uid())
    )
  );

-- comment_analysis は video_id を持たないので、comments → videos の2段で辿る。
create policy "comment_analysis_select_own"
  on public.comment_analysis for select
  to authenticated
  using (
    exists (
      select 1
      from public.comments c
      join public.videos v on v.id = c.video_id
      where c.id = comment_analysis.comment_id
        and v.user_id = (select auth.uid())
    )
  );

create policy "advice_logs_select_own"
  on public.advice_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.videos v
      where v.id = advice_logs.video_id
        and v.user_id = (select auth.uid())
    )
  );
