# スライス4（グルーピングとランキング）ローカル動作確認の手順

## 0. 準備

1. DB を作り直す（新しいマイグレーションを適用するため。データは消える）
   ```bash
   npm install
   npm run db:reset
   npm run db:types   # 型定義を再生成。差分が出なければOK（出たら教えてください）
   ```
2. 自動テストを実行する（AI は偽物を使うので、APIキーは使わない）
   ```bash
   npm test
   ```
   新しく増えたテスト：`tests/grouping.test.ts`（グループへの振り分け。要件定義書0.3の必須のテスト）、`tests/group-comments.test.ts`（グルーピングとランキングの流れ、アクセス制御）
3. `npm run dev` で起動する（`.env.local` の `OPENAI_API_KEY` はスライス3のまま。新しい設定はない）

## 1. ゲストでランキングを確かめる

1. シークレットウィンドウで http://localhost:3000 を開き、コメントの多い動画（質問や要望が多そうなもの。解説・ハウツー系がおすすめ）のURLを入れる
2. 確認すること
   - [ ] 動画を開く前（トップ画面）は、右の枠のランキングに「動画を開くと表示されます」と出る
   - [ ] 分析中は「コメントを分析しています…」と出て、分析が進むと、再読み込みしなくてもランキングが出てくる
   - [ ] 「指摘・要望ランキング」と「質問ランキング」に、それぞれ最大3位まで「1位　代表論点　◯件」の形で出る
   - [ ] 代表論点が、コメントをそのまま写したものではなく、短い見出し（論点）になっている
   - [ ] 代表論点に、動画の主題（料理名など）が入っていない
   - [ ] 件数が多い順に並んでいる
   - [ ] 「AIアドバイス」は「準備中です」のまま
   - [ ] 似ていないコメントが同じグループに入っている、または似たコメントが別々になっている、と感じたら教えてください（閾値 0.6 の調整の参考にします）
   - [ ] 質問ランキングに、豆知識や独り言、反語（「これ本当に美味しいのか？」）が入っていない

## 2. 別の動画に切り替える（ログインユーザー）

1. ログインして、動画を2本登録する
2. 左の一覧で動画を切り替える
   - [ ] 右の枠のランキングが、開いた動画のものに変わる（前の動画のランキングが残らない）

## 3. DB の中身（任意）

Supabase Studio（http://localhost:54323）の SQL Editor で確かめる。

```sql
-- グループの一覧（新しい動画の分。件数が多い順）
select g.group_type, g.representative_text, g.comment_count
from comment_groups g
where g.video_id = (select id from videos order by created_at desc limit 1)
order by g.group_type, g.comment_count desc;

-- グループに入ったコメント（上のグループのどれか1つの中身を見る）
select g.representative_text, c.comment_text, c.like_count
from comment_analysis a
join comments c on c.id = a.comment_id
join comment_groups g on g.id = a.group_id
where a.is_latest and g.video_id = (select id from videos order by created_at desc limit 1)
order by g.representative_text;

-- コメントごとの分類と論点（新しい動画の、グループの対象のもの）
select c.comment_text, a.primary_category, a.topic
from comment_analysis a join comments c on c.id = a.comment_id
where a.is_latest and a.topic is not null
  and c.video_id = (select id from videos order by created_at desc limit 1)
order by a.topic;

-- AI の使用量と推定費用（米ドル）。embeddings が増えている
select endpoint, model, count(*), sum(input_tokens) as input_tokens,
       sum(output_tokens) as output_tokens, sum(estimated_cost_usd) as cost_usd
from api_usage_logs where service = 'openai' group by endpoint, model;
```

- [ ] 返信（`parent_comment_id` があるコメント）は、グループに入っていない
- [ ] 論点が、コメントの中心の話題を短く言い表している。同じ話題なら、同じような言い方になっている
- [ ] `embeddings` の行があり、推定費用が入っている（100件で1円未満の見込み）

## 4. グルーピングの失敗とやり直し（任意）

1. 動画を登録して分析が終わったら、SQL でグループと embedding を消して、「グループに入っていない」状態を作る
   ```sql
   -- 一番新しい動画のグループを消し、分析を「失敗」にする
   update comment_analysis set embedding = null, group_id = null
   where comment_id in (select id from comments where video_id = (select id from videos order by created_at desc limit 1));
   delete from comment_groups where video_id = (select id from videos order by created_at desc limit 1);
   update videos set analysis_status = 'failed' where id = (select id from videos order by created_at desc limit 1);
   ```
2. その動画を開き直す
   - [ ] 「一部のコメントを分析できませんでした」と「分析をやり直す」が出る
   - [ ] 「分析をやり直す」を押すと、分類はやり直さずに（コメントの数はそのまま）、ランキングがもう一度出てくる
