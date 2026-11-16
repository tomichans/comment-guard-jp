-- =============================================================
-- 期限切れ削除ジョブを、1時間ごとに呼び出すように登録する（本番の Supabase だけで1回実行する）
--
-- 要件定義書3.3：Supabase の pg_cron（決まった時刻に SQL を動かす）と pg_net（DB から HTTP を送る）で、
-- 1時間ごとに /api/cron/purge-expired を呼ぶ。削除の本体は TypeScript（src/server/purge-expired.ts）。
--
-- マイグレーション（supabase/migrations/）にしない理由：
--   公開URLと CRON_SECRET は本番にしかなく、ローカルの DB で動かす意味がないため。
--
-- 使い方（docs/deploy.md の手順6）：
--   1. このファイルの中身を、Supabase の画面の SQL Editor に貼る
--   2. 下の2か所（公開URL と CRON_SECRET）を、SQL Editor の上で本物の値に書き換える
--      ※ このファイル自体には、本物の値を書かない（Git に秘密が入ってしまうため）
--   3. Run を押す
-- =============================================================

-- [Supabase固有] 拡張を有効にする（画面の Database → Extensions で有効にしてもよい）
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- [Supabase固有] Vault：秘密の値を、暗号化して DB に保存する仕組み。
-- ジョブの SQL に秘密を直接書くと、cron.job 表に平文で残るため、Vault から読み出す形にする。
select vault.create_secret('https://（公開URL。末尾の / なし）', 'app_url', 'CommentGuard JP の公開URL');
select vault.create_secret('（Vercel に入れた CRON_SECRET と同じ値）', 'cron_secret', '/api/cron/purge-expired の合言葉');

-- 毎時0分に呼ぶ（'0 * * * *' は cron の書き方で「毎時0分」）。
select cron.schedule(
  'purge-expired',
  '0 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/purge-expired',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- -------------------------------------------------------------
-- 確かめ方（登録の1時間後くらいに、SQL Editor で実行する）
--
--   -- ジョブが動いたか（status が succeeded）
--   select status, start_time from cron.job_run_details order by start_time desc limit 5;
--
--   -- アプリが 200 を返したか（status_code が 200、content に削除した件数）
--   select status_code, content, created from net._http_response order by created desc limit 5;
--
-- 値を変えたいとき（公開URLが変わったときなど）：
--   select vault.update_secret((select id from vault.secrets where name = 'app_url'), 'https://新しいURL');
--
-- ジョブを止めたいとき：
--   select cron.unschedule('purge-expired');
-- -------------------------------------------------------------
