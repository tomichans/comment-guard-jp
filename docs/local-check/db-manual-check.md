# DBの手動確認の一覧（～メイン画面作成時点）


## 準備

1. `npx supabase start` と `npm run dev` を起動する
2. DBの中身は Supabase Studio（http://localhost:54323）で見る
   - 表で見る：左の「Table Editor」
   - SQLで見る：左の「SQL Editor」に SQL を貼って「Run」
3. 画面は http://localhost:3000 を Chrome で開く（Console は F12 →「Console」タブ）

※ SQL の `動画のID` などは、Table Editor で見た実際の値に置き換えてください。

---

## 登録

### A12 動画の情報が正しく保存される

1. 画面で YouTube の動画を登録する
2. Table Editor で `videos` を開き、その行を見る

- [ ] `title` が YouTube のタイトルと同じ
- [ ] `thumbnail_url` に `https://i.ytimg.com/...` の URL が入っている
- [ ] `published_at` が YouTube の公開日時と同じ（表示は UTC なので、日本時間より9時間前）
- [ ] `source_id` が `sources` の youtube の行の `id` と同じ

### A13 ログインユーザーの動画は user_id が入り、guest_id は空

1. ログインして、動画を登録する
2. Table Editor で `videos` のその行を見る

- [ ] `user_id` に値が入っていて、`users` の自分の `id` と同じ
- [ ] `guest_id` が空（NULL）

### A14 同じユーザーが同じ動画を2回登録できる

1. ログインしたまま、A13 と同じ URL をもう一度登録する

- [ ] エラーにならず、左の一覧に2本並ぶ
- [ ] `videos` に、同じ `video_id`（YouTube のID）の行が2つある

### A15 コメントの保存に失敗したら、作りかけの動画が残らない

手動では、保存の途中で失敗させる方法がありません。確認するなら自動テストを書く必要があります（今回は見送り）。

- [ ] 確認しない（見送り）

---

## 削除

### D7 削除しても、api_usage_logs の記録は残る

1. ログインして動画を登録し、`videos` でその `id` を控える
2. SQL Editor で、記録が2行以上あることを確かめる

```sql
select endpoint, succeeded, created_at from api_usage_logs where video_id = '動画のID';
```

3. 画面の左の一覧で、その動画を削除する
4. もう一度、同じ SQL を実行する

- [ ] 削除の後も、同じ行が残っている
- [ ] `videos` からは、その動画が消えている

### D8 削除API が正しい番号を返す

画面を開いた状態で、Console に貼って Enter を押す。最後に出る数字を確かめる。

```js
fetch("/api/videos/動画のID", { method: "DELETE" }).then((r) => r.status)
```

- [ ] ログアウトした状態（ゲスト）で、どの ID でも → `403`
- [ ] ログインして、`00000000-0000-4000-8000-000000000000`（存在しないID）→ `404`
- [ ] ログインして、別のユーザーの動画の ID → `404`
- [ ] ログインして、自分の動画の ID → `204`（画面を再読み込みすると、一覧から消えている）

### D9 親コメントを消すと、返信も消える

1. 返信のあるコメントを、SQL Editor で探す

```sql
select parent_comment_id, count(*) from comments
where parent_comment_id is not null group by parent_comment_id limit 5;
```

2. 出てきた `parent_comment_id` を1つ選び、その親コメントを消す

```sql
delete from comments where id = '親コメントのID';
select count(*) from comments where parent_comment_id = '親コメントのID';
```

- [ ] 最後の結果が `0`（返信も消えている）

---

## 期限切れ削除ジョブ

### E6 合言葉（CRON_SECRET）が正しいときだけ動く

ターミナルで実行する。`合言葉` は `.env.local` の `CRON_SECRET` の値。

```bash
curl -i http://localhost:3000/api/cron/purge-expired
curl -i -H "Authorization: Bearer まちがい" http://localhost:3000/api/cron/purge-expired
curl -i -H "Authorization: Bearer 合言葉" http://localhost:3000/api/cron/purge-expired
```

- [ ] 1つ目と2つ目は `401`
- [ ] 3つ目は `200` で、`{"guestVideos":0,"userVideos":0}` のような削除件数が返る

---

## 連鎖削除の例外

### F1 アカウントを消すと、ユーザー・動画・コメントが消える

1. テスト用のアカウントで登録し、動画を1本登録する。`users` の `id` と `videos` の `id` を控える
2. Studio の左の「Authentication」で、そのユーザーを削除する
3. SQL Editor で確かめる

```sql
select count(*) from users where id = 'ユーザーのID';
select count(*) from videos where id = '動画のID';
select count(*) from comments where video_id = '動画のID';
```

- [ ] 3つとも `0`

### F2 グループを消しても、分析結果は残り、group_id だけが空になる

分析結果とグループはスライス3以降で作るので、今は SQL でテスト用の行を作って確かめます。

```sql
-- 1) コメントを1つ選ぶ
select id, video_id from comments limit 1;

-- 2) テスト用のグループと分析結果を作る（コメントのID・動画のIDを置き換える）
insert into comment_groups (id, video_id, group_type, representative_text, representative_embedding, comment_count)
values ('11111111-1111-4111-8111-111111111111', '動画のID', 'feedback_request', 'テスト',
        (select array_fill(0.01, array[1536])::vector), 1);
insert into comment_analysis (comment_id, analyzed_at, primary_category, labels, group_id)
values ('コメントのID', now(), 'feedback', '{}', '11111111-1111-4111-8111-111111111111');

-- 3) グループを消して、分析結果を見る
delete from comment_groups where id = '11111111-1111-4111-8111-111111111111';
select group_id from comment_analysis where comment_id = 'コメントのID';
```

- [ ] 分析結果の行が残っていて、`group_id` が空（NULL）

### F3 アカウントを消しても、api_usage_logs は残り、user_id だけが空になる

F1 と同じアカウントで確かめられます（F1 の手順2の前に、動画の `id` を控えておく）。

```sql
select user_id, endpoint from api_usage_logs where video_id = '動画のID';
```

- [ ] F1 で削除した後も行が残っていて、`user_id` が空（NULL）

### F4 動画が残っている媒体（sources）は消せない

動画が1本以上ある状態で、SQL Editor で実行する。

```sql
delete from sources where name = 'youtube';
```

- [ ] エラーになり、`sources` の youtube の行が残っている

---

## DBの仕組み

### H1 失敗した YouTube の呼び出しも記録される

1. コメントが無効になっている YouTube 動画の URL を登録する（画面に「コメントが無効」のエラーが出る）
2. SQL Editor で、最新の記録を見る

```sql
select endpoint, succeeded, created_at from api_usage_logs order by created_at desc limit 2;
```

- [ ] `commentThreads.list` の行があり、`succeeded` が `false`
- [ ] `videos` には、その動画の行がない

### H2 コメントを更新すると、updated_at が自動で変わる

```sql
select id, updated_at from comments limit 1;
update comments set comment_text = comment_text || '（テスト）' where id = 'コメントのID';
select updated_at from comments where id = 'コメントのID';
```

- [ ] 2回目の `updated_at` が、1回目より新しい時刻になっている

### H3 アカウント登録で、users の行が自動で作られる

1. 画面の「無料で登録する」から、新しいメールアドレスで登録する
2. Table Editor で `users` を開く

- [ ] 新しい行があり、`id` が Authentication のそのユーザーの ID と同じ
- [ ] `role` が `user`

### H4 初期データ（sources の youtube）が入っている

`npx supabase db reset` の直後に、Table Editor で `sources` を開く。

- [ ] `name` が `youtube` の行が1つある

---

## 確認の後

D9・F2・F4・H2 は、テスト用に DB を直接書き換えます。終わったら `npx supabase db reset` で元に戻してください（ローカルのデータはすべて消えます）。
