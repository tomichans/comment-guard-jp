-- =============================================================
-- コメントの論点（comment_topics）と、論点を使うグルーピング・ランキング（テーブル定義書 5.10、7章。要件定義書10章）
--
-- 【確定】1つのコメントは、質問ランキングと指摘・要望ランキングの両方に入れる（最大2つ）。
--   例：「BGMうるさい。あと鍋どこの？」→ 質問の論点「使っている鍋」と、指摘の論点「BGMの音量」
--   コメント1件に論点が0〜2個あるので、論点を別の表（comment_topics）に分ける。
--   そのため、comment_analysis の group_id と embedding は、comment_topics に移す。
--
-- 【確定】論点を出すのは、分類の AI（要件定義書8.7）。要注意（harmful）のコメントも対象にする。
--   スパムと返信は対象外。論点を作らないので、この表に行が入らない。
-- =============================================================

-- -------------------------------------------------------------
-- comment_topics：コメントの論点（ランキング1種類につき1つ）
-- -------------------------------------------------------------
-- 分析結果（comment_analysis）にぶら下げる。本文が変わって分析し直すと、古い分析結果（is_latest = false）の論点は、
-- ランキングの件数に数えられなくなる（refresh_group_counts と video_rankings は、最新の分析結果の論点だけを数える）。
create table public.comment_topics (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.comment_analysis (id) on delete cascade,
  group_type public.group_type not null,
  -- 論点（20字以内の名詞句。例：「イタリアンパセリの代用」）
  topic text not null,
  -- 論点の Embedding。グルーピングの後に、group_id と一緒に書き込む（要件定義書10.3）。
  embedding extensions.vector(1536),
  group_id uuid references public.comment_groups (id) on delete set null,
  created_at timestamptz not null default now(),
  -- 1つの分析結果につき、ランキング1種類ごとに論点は1つ
  unique (analysis_id, group_type)
);

create index idx_comment_topics_group_id on public.comment_topics (group_id);

-- ゲストのデータは API Route（service role）からだけ読む。ログインユーザーは自分の動画の分だけ読める（他の子テーブルと同じ）。
alter table public.comment_topics enable row level security;

create policy "comment_topics_select_own"
  on public.comment_topics for select
  to authenticated
  using (
    exists (
      select 1
      from public.comment_analysis a
      join public.comments c on c.id = a.comment_id
      join public.videos v on v.id = c.video_id
      where a.id = comment_topics.analysis_id
        and v.user_id = (select auth.uid())
    )
  );

-- グループと Embedding は comment_topics に移したので、comment_analysis からは消す（インデックスも一緒に消える）。
alter table public.comment_analysis drop column group_id;
alter table public.comment_analysis drop column embedding;

-- -------------------------------------------------------------
-- comments_to_group：グループに振り分ける論点を、limit 件まで返す
-- -------------------------------------------------------------
-- 最新の分析結果の論点のうち、まだ embedding がないもの。対象（親コメント・スパム以外）は、論点を作るときに絞ってある。
drop function public.comments_to_group(uuid, integer);

create function public.comments_to_group(p_video_id uuid, p_limit integer)
returns table (
  topic_id uuid,
  group_type public.group_type,
  topic text
)
language sql
stable
set search_path = ''
as $$
  select t.id, t.group_type, t.topic
  from public.comment_topics t
  join public.comment_analysis a on a.id = t.analysis_id and a.is_latest
  join public.comments c on c.id = a.comment_id
  where c.video_id = p_video_id
    and t.embedding is null
  -- 古いコメントから振り分ける（毎回同じ順番にするため）。
  order by c.posted_at nulls last, c.id, t.group_type
  limit p_limit
$$;

revoke execute on function public.comments_to_group(uuid, integer) from public, anon, authenticated;
grant execute on function public.comments_to_group(uuid, integer) to service_role;

-- -------------------------------------------------------------
-- refresh_group_counts：グループの件数を、最新の分析結果の論点の数で数え直す
-- -------------------------------------------------------------
create or replace function public.refresh_group_counts(p_video_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.comment_groups g
  set comment_count = (
        select count(*)
        from public.comment_topics t
        join public.comment_analysis a on a.id = t.analysis_id and a.is_latest
        where t.group_id = g.id
      ),
      updated_at = now()
  where g.video_id = p_video_id
$$;

-- -------------------------------------------------------------
-- video_rankings：並び順は 20261027000001_grouping.sql と同じ。グループのコメントを、論点の表から辿るようにする
-- -------------------------------------------------------------
create or replace function public.video_rankings(p_video_id uuid, p_limit integer)
returns json
language sql
stable
set search_path = ''
as $$
  with stats as (
    select g.id, g.group_type, g.representative_text, g.comment_count,
           coalesce(sum(c.like_count), 0) as total_likes,
           max(c.posted_at) as latest_posted_at
    from public.comment_groups g
    join public.comment_topics t on t.group_id = g.id
    join public.comment_analysis a on a.id = t.analysis_id and a.is_latest
    join public.comments c on c.id = a.comment_id
    where g.video_id = p_video_id and g.comment_count > 0
    group by g.id
  ),
  ranked as (
    select s.*,
           row_number() over (
             partition by s.group_type
             order by s.comment_count desc, s.total_likes desc, s.latest_posted_at desc nulls last, s.id
           ) as rank
    from stats s
  )
  select json_build_object(
    'feedback_request', coalesce((
      select json_agg(json_build_object('id', r.id, 'rank', r.rank, 'text', r.representative_text, 'count', r.comment_count) order by r.rank)
      from ranked r where r.group_type = 'feedback_request' and r.rank <= p_limit
    ), '[]'::json),
    'question', coalesce((
      select json_agg(json_build_object('id', r.id, 'rank', r.rank, 'text', r.representative_text, 'count', r.comment_count) order by r.rank)
      from ranked r where r.group_type = 'question' and r.rank <= p_limit
    ), '[]'::json)
  )
$$;
