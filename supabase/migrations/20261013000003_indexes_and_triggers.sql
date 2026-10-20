-- =============================================================
-- インデックス（テーブル定義書 6章）と updated_at の自動更新トリガー
-- =============================================================

-- -------------------------------------------------------------
-- 6.1 個別に定義するもの
-- -------------------------------------------------------------

-- 「現在の分析結果」（WHERE comment_id = X AND is_latest = true）は全画面で頻発するため、
-- 2列まとめた複合インデックスにする。
create index idx_comment_analysis_latest
  on public.comment_analysis (comment_id, is_latest);

-- ゲストは同時に1本しか動画を持てない（要件定義書3.1）。
-- アプリ側でもチェックするが、同時に2リクエストが来た場合などの競合はアプリだけでは防げない。
-- 部分ユニークインデックス（WHERE 付き）にすることで、user_id の動画（guest_id が NULL）は対象外になる。
create unique index idx_videos_guest_id_unique
  on public.videos (guest_id)
  where guest_id is not null;

-- 同じ YouTube コメントの重複登録を防ぐ（要件定義書7.4）。
-- external_comment_id が NULL の行は、PostgreSQL の仕様上ユニーク判定の対象にならない。
create unique index idx_comments_video_external_unique
  on public.comments (video_id, external_comment_id);

-- 1コメントにつき「最新の分析結果」は1行だけ。再分析で is_latest を立て忘れても DB が拒否する。
create unique index idx_comment_analysis_latest_unique
  on public.comment_analysis (comment_id)
  where is_latest;

-- 期限切れ削除ジョブは created_at で検索するため。
create index idx_videos_created_at
  on public.videos (created_at);

-- -------------------------------------------------------------
-- 6.2 FK列のインデックス
-- PostgreSQL は外部キーに自動でインデックスを作らない。
-- インデックスがないと、JOIN や、親を削除したときの CASCADE（子の検索）が全件走査になる。
-- -------------------------------------------------------------
create index idx_videos_user_id on public.videos (user_id);
create index idx_videos_source_id on public.videos (source_id);
-- comments.video_id は idx_comments_video_external_unique の先頭列で代用できる。
create index idx_comments_parent_comment_id on public.comments (parent_comment_id);
-- comment_analysis.comment_id は idx_comment_analysis_latest の先頭列で代用できる。
create index idx_comment_analysis_group_id on public.comment_analysis (group_id);
create index idx_comment_groups_video_id on public.comment_groups (video_id);
create index idx_advice_logs_video_id on public.advice_logs (video_id);
create index idx_advice_logs_user_id on public.advice_logs (user_id);

-- -------------------------------------------------------------
-- updated_at の自動更新
-- アプリ側で毎回 updated_at = now() を書くと、書き忘れが起きる。
-- トリガーにしておけば、どこから UPDATE しても必ず更新される。
-- -------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
-- search_path を空にして、関数内の名前解決を固定する（別スキーマの同名関数にすり替えられないため）。
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- comment_groups.updated_at も「レコード更新日時」（テーブル定義書5.4）なので、同じトリガーを付ける。
-- 合流時の comment_count += 1 で更新される。
create trigger trg_comment_groups_set_updated_at
  before update on public.comment_groups
  for each row execute function public.set_updated_at();
