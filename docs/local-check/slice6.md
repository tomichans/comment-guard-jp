# スライス6 ①（利用規約・プライバシー、利用上限）ローカル動作確認の手順

## 0. 準備

1. 依存を入れ直す（新しいマイグレーションはないので、DB の作り直しは不要）
   ```bash
   npm install
   ```
2. 自動テストを実行する（ローカルの Supabase を起動しておく）
   ```bash
   npm test
   ```
   増えたテスト：
   - `tests/register-video.test.ts`：ログインユーザー1人1日10本、アプリ全体1日50本の上限
   - `tests/purge-expired.test.ts`：90日を超えた API使用量の記録が削除されること
   - 手元の画面で1日に50本近く登録した後は、アプリ全体の上限で登録のテストが落ちることがある。そのときは `npm run db:reset`
3. `npm run dev` で起動する

## 1. 利用規約・プライバシーポリシー

1. http://localhost:3000 を開く
2. 確認すること
   - [ ] 左の枠のいちばん下に「利用規約」「プライバシーポリシー」のリンクがある
   - [ ] 左の枠を閉じても、下のアイコン（書類の形）から利用規約を開ける
   - [ ] http://localhost:3000/terms と http://localhost:3000/privacy が、ログインしていなくても開ける
   - [ ] 運営者「tomita」と、連絡先 next.tomita.js@gmail.com が出る（メールのリンクを押すとメールアプリが開く）
   - [ ] 保持期間（24時間、29日、90日）と上限（5本、10本）の数字が正しい
   - [ ] 「アプリに戻る」でメイン画面に戻れる
   - [ ] 登録画面（/signup）に「登録すると、利用規約とプライバシーポリシーに同意したものとみなします」と出て、リンクが開ける
   - [ ] 文章に、事実と違うところや、言い回しを変えたいところがあれば教えてください

## 2. ログインユーザー1人1日10本の上限

本当に10本登録すると AI の費用がかかるので、Supabase Studio で「10本登録した」記録を足して確かめる。

1. ログインして、左下に出るメールアドレスを確認する
2. Supabase Studio（http://127.0.0.1:54323）の SQL Editor で、次を実行する（メールアドレスは自分のものに変える）
   ```sql
   insert into api_usage_logs (service, endpoint, succeeded, user_id)
   select 'youtube', 'videos.list', true, id
   from auth.users, generate_series(1, 10)
   where email = 'あなたのメールアドレス';
   ```
3. 確認すること
   - [ ] 新しい動画のURLを入れると「1日に分析できる動画の数（10本）に達しました。時間をおいて再度お試しください」と出て、登録されない
4. 後片付け（足した記録を消す）
   ```sql
   delete from api_usage_logs
   where user_id = (select id from auth.users where email = 'あなたのメールアドレス')
     and created_at > now() - interval '1 hour';
   ```

## 3. アプリ全体1日50本の上限

1. SQL Editor で、次を実行する（ゲストの記録として50件足す）
   ```sql
   insert into api_usage_logs (service, endpoint, succeeded, guest_id)
   select 'youtube', 'videos.list', true, '00000000-0000-4000-8000-000000000050'
   from generate_series(1, 50);
   ```
2. 確認すること
   - [ ] ログインユーザーで動画を登録しようとすると「アプリ全体の1日の利用上限に達しました。時間をおいて再度お試しください」と出る
   - [ ] シークレットウィンドウ（ゲスト）でも、同じメッセージが出る
3. 後片付け
   ```sql
   delete from api_usage_logs where guest_id = '00000000-0000-4000-8000-000000000050';
   ```

## 4. API使用量の記録の削除（90日）

自動テスト（`tests/purge-expired.test.ts`）で確かめているので、手での確認は不要。
本番では、デプロイのときに登録する1時間ごとのジョブが、動画と一緒に消す。
