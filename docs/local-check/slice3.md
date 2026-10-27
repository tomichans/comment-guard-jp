# スライス3（コメントの分類）ローカル動作確認の手順

## 0. 準備

1. `.env.local` に次の2行を足す（値の取り方は README の「OpenAI APIキーの取得」）
   ```
   OPENAI_API_KEY=sk-...
   OPENAI_CLASSIFY_MODEL=
   ```
   `OPENAI_CLASSIFY_MODEL` は空のままでよい（既定の `gpt-6-luna` を使う）。
2. ライブラリを入れ直し、DB を作り直す（新しいマイグレーションを適用するため。データは消える）
   ```bash
   npm install
   npm run db:reset
   npm run db:types   # 型定義を再生成。差分が出なければOK（出たら教えてください）
   ```
3. 自動テストを実行する（AI は偽物を使うので、APIキーは使わない）
   ```bash
   npm test
   ```
   新しく増えたテスト：`tests/analysis-rules.test.ts`（NGワードと判定のルール）、`tests/analyze.test.ts`（分析の流れ、失敗とやり直し、タブの絞り込み、アクセス制御）
4. `npm run dev` で起動する

## 1. ゲストで分類を確かめる

1. シークレットウィンドウで http://localhost:3000 を開き、コメントの多い動画のURLを入れる
2. 確認すること
   - [ ] 動画を開いた直後、コメント一覧の上に「コメントを分析しています（0／N件）」が出て、数秒ごとに数字が増える
   - [ ] 分析が済んだコメントから、タブに表示される（分析前のコメントは出ない）
   - [ ] タブが7つ（ポジティブ、質問、指摘・要望、否定的意見、スパム、要注意・攻撃的、すべて）並び、それぞれに件数が出る
   - [ ] 開いたときは「ポジティブ」が選ばれている
   - [ ] 「否定的意見」「スパム」「要注意・攻撃的」「すべて」は、選んでいないとき半透明
   - [ ] 「すべて」を押すと「誹謗中傷・スパムを含むコメントも表示されます。よろしいですか？」が出る。キャンセルするとタブは変わらない
   - [ ] 「要注意・攻撃的」を押しても、確認は出ない
   - [ ] 分析が終わると、進み具合の帯が消える
   - [ ] 分類が大きく外れていないか（質問が「質問」に、要望が「指摘・要望」に入っているか）。気になったコメントがあれば教えてください（プロンプトを直します）

## 2. 攻撃的な返信の「要注意」の印

返信の付いたコメントで、返信を開く。攻撃的な返信が見つからないときは、Supabase Studio（http://localhost:54323）の SQL Editor で、返信の1件を harmful にして確かめる。

```sql
-- 返信の分析結果を1件、harmful にする
update comment_analysis set primary_category = 'harmful'
where is_latest and comment_id = (
  select id from comments where parent_comment_id is not null limit 1
);
```

- [ ] その返信の名前の横に、赤い「要注意」の印が出る（画面を再読み込みしてから、返信を開く）

## 3. AI の失敗と「分析をやり直す」

1. `.env.local` の `OPENAI_API_KEY` を、わざと間違った値（例：末尾を1文字消す）にして、`npm run dev` を起動し直す
2. ログインして（ゲストは1本しか登録できないので）、動画を登録する
3. 確認すること
   - [ ] 少し待つと「一部のコメントを分析できませんでした（0／N件が分析済み）」と「分析をやり直す」ボタンが出る
   - [ ] 「すべて」タブで、分析できなかったコメントが「未分析」の印付きで見られる
4. `OPENAI_API_KEY` を正しい値に戻して、`npm run dev` を起動し直す
5. 「分析をやり直す」を押す
   - [ ] 「コメントを分析しています」に変わり、最後まで分析される

## 4. ログインユーザーの多いコメント（任意）

コメントが1000件近くある動画で確かめる（YouTube のクォータを最大11ユニット使う）。

- [ ] 最初の分析結果が自動で表示され、その後に分析された分は「新しく分析された◯件を表示する」ボタンで表示できる
- [ ] 最後まで分析が終わる（数分かかることがある）

## 5. 止まった分析の扱い（任意）

サーバーの処理が途中で止まった場合を、SQL で再現する。

```sql
-- 一番新しい動画を「10分前から分析中のまま」にする
update videos set analysis_status = 'analyzing', analysis_started_at = now() - interval '10 minutes'
where id = (select id from videos order by created_at desc limit 1);
```

- [ ] その動画を開くと、「分析中」ではなく「一部のコメントを分析できませんでした」と「分析をやり直す」が出る

## 6. DB の中身（任意）

Supabase Studio の SQL Editor で確かめる。

```sql
-- 分類の結果（新しい順に20件）
select c.comment_text, a.primary_category, a.labels, a.score, a.ng_words, a.review_required
from comment_analysis a join comments c on c.id = a.comment_id
where a.is_latest order by a.analyzed_at desc limit 20;

-- AI の使用量と推定費用（米ドル）
select endpoint, model, count(*), sum(input_tokens) as input_tokens,
       sum(output_tokens) as output_tokens, sum(estimated_cost_usd) as cost_usd
from api_usage_logs where service = 'openai' group by endpoint, model;
```

- [ ] `classify` と `moderations` の行がある。`classify` の推定費用が入っている（100件で数円以下の見込み）
