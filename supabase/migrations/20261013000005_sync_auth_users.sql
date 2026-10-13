-- =============================================================
-- Supabase Auth のユーザーと public.users の同期（要件定義書13.2）
--
-- 【確定】DB トリガー方式。auth.users に行が追加されたら、public.users を自動で作る。
-- 理由：サインアップの経路（メール、将来の OAuth、管理画面からの追加など）に関わらず必ず作られ、
--       アプリ側での作り忘れが起きない。videos.user_id の外部キーも、サインアップ直後から満たせる。
--
-- 削除側の同期は不要：users.id → auth.users.id は ON DELETE CASCADE なので、
-- Auth のユーザーを消せば public.users も（さらに videos 以下も）連鎖して消える。
-- =============================================================

-- [Supabase固有] auth スキーマは Supabase Auth が管理していて、ログイン中のユーザー権限では書き込めない。
-- そこで `security definer`（関数の作成者＝postgres の権限で実行する）を付けて、
-- サインアップ処理の中から public.users に INSERT できるようにしている。
-- 権限の強い関数なので、search_path を空にして、名前をすべてスキーマ付きで書く（すり替え対策）。
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- name、role は既定値（NULL、'user'）のまま。
  -- TODO(未決定): 追加のプロフィール項目（要件定義書3.2、13.2）。決まったら raw_user_meta_data から取り込む。
  insert into public.users (id) values (new.id);
  return new;
end;
$$;

-- [Supabase固有] auth.users は Supabase Auth がサインアップ時に INSERT するテーブル。
-- そこにトリガーを付けるのは、Supabase 公式ドキュメントでも紹介されている定番のやり方。
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
