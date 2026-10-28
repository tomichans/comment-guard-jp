-- =============================================================
-- グルーピングを「論点」で比べるようにする（テーブル定義書 5.3、7章。要件定義書10.3）
--
-- 【確定】comment_analysis.topic：分類の AI が、分類と一緒に出すコメントの論点（例：「イタリアンパセリの代用」）。
--   グルーピングでは、本文ではなく論点の Embedding を比べる。本文どうしを比べると、
--   動画の主題（料理名など）がどのコメントにも出てくるので、論点が違っても似て見えてしまうため。
--   グループの対象（質問・指摘・要望）のコメントだけに入り、それ以外は NULL。
-- =============================================================

alter table public.comment_analysis add column topic text;

-- comments_to_group が論点も返すようにする（返す列が変わるので、作り直す）。
drop function public.comments_to_group(uuid, integer);

create function public.comments_to_group(p_video_id uuid, p_limit integer)
returns table (
  analysis_id uuid,
  comment_text text,
  topic text,
  primary_category public.primary_category,
  labels text[]
)
language sql
stable
set search_path = ''
as $$
  select a.id, c.comment_text, a.topic, a.primary_category, a.labels
  from public.comments c
  join public.comment_analysis a on a.comment_id = c.id and a.is_latest
  where c.video_id = p_video_id
    and c.parent_comment_id is null
    and a.embedding is null
    and a.primary_category not in ('harmful', 'spam')
    and (a.primary_category in ('question', 'feedback') or 'request' = any(a.labels))
  order by c.posted_at nulls last, c.id
  limit p_limit
$$;

revoke execute on function public.comments_to_group(uuid, integer) from public, anon, authenticated;
grant execute on function public.comments_to_group(uuid, integer) to service_role;
