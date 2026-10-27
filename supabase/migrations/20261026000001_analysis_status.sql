-- =============================================================
-- スライス3：コメント分析の状況と、分析用の関数（テーブル定義書 4.6、5.1、8章）
--
-- 【確定】videos.analysis_status、analysis_started_at：コメント分析の状況（分析中／完了／失敗）を画面に出すため（要件定義書15.2）。
--   失敗しても、分析済みの結果は残す。「分析されていないコメント」は comment_analysis に
--   is_latest = true の行がないコメントなので、やり直すときは、その分だけを分析する。
-- =============================================================

-- -------------------------------------------------------------
-- videos.analysis_status
-- -------------------------------------------------------------
create type public.analysis_status as enum (
  'analyzing',
  'done',
  'failed'
);

-- 新しく作る動画は、アプリが作成時に analyzing を明示的に入れる。
alter table public.videos
  add column analysis_status public.analysis_status not null default 'analyzing';

-- 分析を始めた（やり直した）時刻。「分析中」のまま止まっていないかの判定に使う（src/server/analysis/status.ts）。
-- サーバーの処理が時間切れなどで途中で止まると、analysis_status が analyzing のまま残ってしまうため、
-- この時刻と、最後の API 呼び出しの時刻から、一定時間なにも進んでいなければ「失敗」として扱う。
alter table public.videos
  add column analysis_started_at timestamptz not null default now();

-- 上の判定で「この動画の最後の API 呼び出し」を探すため（テーブル定義書6.1）。
create index idx_api_usage_logs_video_id_created_at
  on public.api_usage_logs (video_id, created_at);

-- スライス3より前に登録した動画は、まだ1件も分析されていない。
-- 「失敗」と同じ扱いにして、画面の「分析をやり直す」ボタンから分析できるようにする。
update public.videos set analysis_status = 'failed';

-- -------------------------------------------------------------
-- comments_to_analyze：まだ分析されていないコメントを、limit 件まで返す
-- -------------------------------------------------------------
-- 「最新の分析結果（is_latest = true）がないコメント」を探す。
-- 本文が変わったコメントは、保存時に古い結果を is_latest = false にする（src/server/comments/save.ts）ので、
-- 同じ条件で再分析の対象にもなる（要件定義書7.4）。
-- 親コメントを先に返すのは、画面のタブに、スレッドの先頭（親コメント）から早く出すため。
-- この条件は PostgREST（supabase-js）のクエリでは書きにくいので、SQL の関数にしている。
create function public.comments_to_analyze(p_video_id uuid, p_limit integer)
returns setof public.comments
language sql
stable
-- [Supabase固有] search_path を空にして、関数の中ではスキーマ名付きで書く（Supabase の推奨。別のスキーマの同名の表を誤って使わないため）。
set search_path = ''
as $$
  select c.*
  from public.comments c
  where c.video_id = p_video_id
    and not exists (
      select 1 from public.comment_analysis a
      where a.comment_id = c.id and a.is_latest
    )
  order by (c.parent_comment_id is not null), c.posted_at desc nulls last, c.id
  limit p_limit
$$;

-- サーバー（service role）専用。ブラウザからは呼べないようにする。
-- [Supabase固有] Supabase では、public に作った関数は既定で anon と authenticated も実行できるので、明示的に外す。
revoke execute on function public.comments_to_analyze(uuid, integer) from public, anon, authenticated;
grant execute on function public.comments_to_analyze(uuid, integer) to service_role;

-- -------------------------------------------------------------
-- video_analysis_summary：動画の分析の進み具合と、タブごとの件数
-- -------------------------------------------------------------
-- 返す値（json）
--   total    … 動画のコメント数（親と返信）
--   analyzed … そのうち、分析が済んだ数
--   counts   … 分析が済んだ親コメントの、primary_category ごとの数（タブの件数。例：{"praise": 12, ...}）
-- security invoker（既定）なので、ログインユーザーのクライアントで呼ぶと RLS が効き、自分の動画のコメントしか数えない。
-- ゲストは、サーバーが所有を確認してから service role で呼ぶ（src/server/access.ts）。
create function public.video_analysis_summary(p_video_id uuid)
returns json
language sql
stable
set search_path = ''
as $$
  select json_build_object(
    'total', (
      select count(*) from public.comments c where c.video_id = p_video_id
    ),
    'analyzed', (
      select count(*)
      from public.comments c
      join public.comment_analysis a on a.comment_id = c.id and a.is_latest
      where c.video_id = p_video_id
    ),
    'counts', coalesce((
      select json_object_agg(s.primary_category, s.n)
      from (
        select a.primary_category, count(*) as n
        from public.comments c
        join public.comment_analysis a on a.comment_id = c.id and a.is_latest
        where c.video_id = p_video_id and c.parent_comment_id is null
        group by a.primary_category
      ) s
    ), '{}'::json)
  )
$$;

revoke execute on function public.video_analysis_summary(uuid) from public, anon;
grant execute on function public.video_analysis_summary(uuid) to authenticated, service_role;
