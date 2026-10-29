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

## 1-2. 返信の「要注意」とランキングの選択

1. 動画のページで、確認すること
   - [ ] 攻撃的な返信があるスレッドは、返信を開く前から「返信を表示（◯件）」の隣に「要注意の返信 ◯件」が出る
     （探しにくければ、「要注意・攻撃的」タブや、SQL で `primary_category = 'harmful'` の返信を探してから、その親コメントを見る）
   - [ ] 右の枠のランキングの項目にマウスを乗せると色が変わり、選べる
   - [ ] 項目を選ぶと、中央の一覧のタブの代わりに「指摘・要望ランキング『代表論点』のコメント」と出て、そのグループのコメントだけになる
   - [ ] その下に「おだやか」「要注意」のタブがあり、最初は「おだやか」が選ばれている。「要注意」は半透明
   - [ ] 「おだやか」と「要注意」の件数の合計が、ランキングの「◯件」と同じ
   - [ ] 「要注意」を押すと、確認なしで、要注意のコメントだけが出る
   - [ ] 別のランキングの項目を選ぶと、タブは「おだやか」に戻る
   - [ ] 選んだ項目は、右の枠で色が付いたままになる
   - [ ] 検索と並び順の切り替えが、絞り込んだまま使える
   - [ ] 「絞り込みを解除」か、同じ項目をもう一度選ぶと、タブの一覧に戻る（タブは選んでいたものに戻る）
   - [ ] 選んだ状態で再読み込みしても、同じ表示になる。ブラウザの「戻る」で、選ぶ前の表示に戻る

## 2. 別の動画に切り替える（ログインユーザー）

1. ログインして、動画を2本登録する
2. 左の一覧で動画を切り替える
   - [ ] 右の枠のランキングが、開いた動画のものに変わる（前の動画のランキングが残らない）
   - [ ] ランキングを選んだ状態で別の動画に切り替えると、絞り込みは解除される

## 3. DB の中身（任意）

Supabase Studio（http://localhost:54323）の SQL Editor で確かめる。

```sql
-- グループの一覧（新しい動画の分。件数が多い順）
select g.group_type, g.representative_text, g.comment_count
from comment_groups g
where g.video_id = (select id from videos order by created_at desc limit 1)
order by g.group_type, g.comment_count desc;

-- グループに入ったコメント（グループごとに、論点と本文と分類を並べる）
select g.group_type, g.representative_text, t.topic, a.primary_category, c.comment_text, c.like_count
from comment_topics t
join comment_analysis a on a.id = t.analysis_id and a.is_latest
join comments c on c.id = a.comment_id
join comment_groups g on g.id = t.group_id
where g.video_id = (select id from videos order by created_at desc limit 1)
order by g.group_type, g.representative_text;

-- コメントごとの分類と論点（新しい動画の親コメント。論点のないコメントも出す。1コメント最大2行）
select c.comment_text, a.primary_category, a.labels, t.group_type, t.topic
from comments c
join comment_analysis a on a.comment_id = c.id and a.is_latest
left join comment_topics t on t.analysis_id = a.id
where c.parent_comment_id is null
  and c.video_id = (select id from videos order by created_at desc limit 1)
order by a.primary_category, c.comment_text;

-- 要注意（harmful）になったコメント（基準を厳しくしたので、きつい言い方のものが入っているはず）
select c.comment_text, a.labels, a.score
from comments c join comment_analysis a on a.comment_id = c.id and a.is_latest
where a.primary_category = 'harmful'
  and c.video_id = (select id from videos order by created_at desc limit 1);

-- AI の使用量と推定費用（米ドル）。embeddings が増えている
select endpoint, model, count(*), sum(input_tokens) as input_tokens,
       sum(output_tokens) as output_tokens, sum(estimated_cost_usd) as cost_usd
from api_usage_logs where service = 'openai' group by endpoint, model;
```

- [ ] 返信（`parent_comment_id` があるコメント）とスパムは、グループに入っていない
- [ ] 要注意のコメントでも、質問や指摘があれば、論点があってグループに入っている。その論点（見出し）に、暴言やきつい言い方が入っていない
- [ ] 質問と要望の両方を含むコメントは、論点が2行（`question` と `feedback_request`）ある
- [ ] 「は？意味不明」のような、きつい言い方のコメントが要注意になっている。丁寧な否定的な意見は、否定的意見のまま
- [ ] 論点が、コメントの中心の話題を短く言い表している。同じ話題なら、同じような言い方になっている
- [ ] `embeddings` の行があり、推定費用が入っている（100件で1円未満の見込み）

## 4. グルーピングの失敗とやり直し（任意）

1. 動画を登録して分析が終わったら、SQL でグループと embedding を消して、「グループに入っていない」状態を作る
   ```sql
   -- 一番新しい動画のグループを消し、分析を「失敗」にする
   update comment_topics set embedding = null, group_id = null
   where analysis_id in (select a.id from comment_analysis a join comments c on c.id = a.comment_id
                         where c.video_id = (select id from videos order by created_at desc limit 1));
   delete from comment_groups where video_id = (select id from videos order by created_at desc limit 1);
   update videos set analysis_status = 'failed' where id = (select id from videos order by created_at desc limit 1);
   ```
2. その動画を開き直す
   - [ ] 「一部のコメントを分析できませんでした」と「分析をやり直す」が出る
   - [ ] 「分析をやり直す」を押すと、分類はやり直さずに（コメントの数はそのまま）、ランキングがもう一度出てくる
