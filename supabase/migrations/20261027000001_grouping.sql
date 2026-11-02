-- =============================================================
-- スライス4：グルーピングとランキングの関数（テーブル定義書 7章）
--
-- テーブルは変えない（comment_groups と comment_analysis.embedding / group_id は、スライス1で作ってある）。
-- PostgREST（supabase-js）のクエリでは書きにくい条件と集計を、SQL の関数にする。
-- =============================================================

-- -------------------------------------------------------------
-- comments_to_group：グループに振り分ける対象のコメントを、limit 件まで返す
-- -------------------------------------------------------------
-- 対象【確定】（要件定義書10.1）
--   - 最新の分析結果（is_latest）が、まだ embedding を持っていない
--   - 親コメント（返信は対象外【確定】）
--   - harmful と spam を除き、primary_category が question か feedback、または labels に request を含む
-- この条件は、src/server/analysis/grouping.ts の groupTypeOf() と同じ。片方を変えるときは、もう片方も直す。
create function public.comments_to_group(p_video_id uuid, p_limit integer)
returns table (
  analysis_id uuid,
  comment_text text,
  primary_category public.primary_category,
  labels text[]
)
language sql
stable
set search_path = ''
as $$
  select a.id, c.comment_text, a.primary_category, a.labels
  from public.comments c
  join public.comment_analysis a on a.comment_id = c.id and a.is_latest
  where c.video_id = p_video_id
    and c.parent_comment_id is null
    and a.embedding is null
    and a.primary_category not in ('harmful', 'spam')
    and (a.primary_category in ('question', 'feedback') or 'request' = any(a.labels))
  -- 古いコメントから振り分ける（毎回同じ順番にするため）。
  order by c.posted_at nulls last, c.id
  limit p_limit
$$;

revoke execute on function public.comments_to_group(uuid, integer) from public, anon, authenticated;
grant execute on function public.comments_to_group(uuid, integer) to service_role;

-- -------------------------------------------------------------
-- refresh_group_counts：動画のグループの件数（comment_count）を数え直す
-- -------------------------------------------------------------
-- 【確定】+1 で増やすのではなく、そのつど「最新の分析結果のうち、そのグループに入っているもの」を数え直す（要件定義書10.3）。
-- こうすると、本文が変わって分析し直したコメント（古い結果は is_latest = false）は、元のグループから自然に抜ける。
-- 件数が0になったグループは消さずに残し、ランキングに出さない（video_rankings）。
create function public.refresh_group_counts(p_video_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.comment_groups g
  set comment_count = (
        select count(*) from public.comment_analysis a
        where a.group_id = g.id and a.is_latest
      ),
      updated_at = now()
  where g.video_id = p_video_id
$$;

revoke execute on function public.refresh_group_counts(uuid) from public, anon, authenticated;
grant execute on function public.refresh_group_counts(uuid) to service_role;

-- -------------------------------------------------------------
-- video_rankings：指摘・要望ランキングと質問ランキング（上位 p_limit 件ずつ）
-- -------------------------------------------------------------
-- 並び順【確定】（要件定義書11章）
--   1. 件数（comment_count）が多い順
--   2. 件数が同じなら、グループのコメントのいいねの合計が多い順
--   3. それも同じなら、グループのいちばん新しいコメントが新しい順
--   （最後に id で並べて、順番を毎回同じにする）
-- 順位は 1、2、3 の連番にし、「同率」は出さない【確定】。件数が0のグループは出さない。
-- 返す値：{"feedback_request": [{id, rank, text, count}, ...], "question": [...]}
--   id はグループの id。画面でランキングを選んだときに、そのグループのコメントの一覧を出すのに使う。
-- security invoker（既定）なので、ログインユーザーのクライアントで呼ぶと RLS が効く（video_analysis_summary と同じ）。
create function public.video_rankings(p_video_id uuid, p_limit integer)
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
    join public.comment_analysis a on a.group_id = g.id and a.is_latest
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

revoke execute on function public.video_rankings(uuid, integer) from public, anon;
grant execute on function public.video_rankings(uuid, integer) to authenticated, service_role;
