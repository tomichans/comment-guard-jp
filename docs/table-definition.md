# CommentGuard JP テーブル定義書

`docs/requirements.md`（要件定義書）と対になるファイルです。設計の背景・理由は要件定義書の13章を参照してください。

- **【確定】**：決定済み。そのとおりに作成する。
- **【未決定】**：まだ決まっていない。第7章に一覧がある。
- **【要確認】**：要件定義書との整合が取れていない。確認が取れるまで実装しない。

---

## 1. 共通事項

- DB：Supabase PostgreSQL
- 主キー `id` は `uuid`（`DEFAULT gen_random_uuid()`）
- 日時の列は `timestamptz`（タイムゾーン付き）とする。
  - 理由：ゲストデータの24時間削除など、時刻の比較があるため。
- `created_at` は `DEFAULT now()`
- `vector` 型を使うため、拡張 `vector`（pgvector）を有効化する。
- ゲスト用の `guest_id` はCookieで発行するUUIDで、外部キーを持たない。

---

## 2. テーブル一覧（8テーブル）

| テーブル | 役割 |
| --- | --- |
| `videos` | 動画メタを保持する。媒体種別・媒体側ID・タイトル・サムネイル等を格納する。所有者（ユーザーまたはゲスト）もここだけが持つ。 |
| `comments` | 各動画のコメント本文と投稿メタを保持する。外部コメントIDや投稿日時を含む。 |
| `comment_analysis` | AIとルールの判定結果を保存する。`primary_category`、`labels`、`score` 等を含む。 |
| `comment_groups` | 指摘・要望／質問の類似コメントをグルーピングし、ランキングの元データを保持する。 |
| `ng_words` | NGワード辞書。正規化表現と危険度を持ち、ルール判定の根拠になる。 |
| `advice_logs` | AIが生成したアドバイスの履歴を保存する。モデル情報と生成時刻を記録する。 |
| `users` | 認証ユーザーのプロフィールと権限情報を保持する。 |
| `sources` | 媒体情報を管理する。MVPは `youtube` のみ。 |

---

## 3. リレーション（外部キー）

| 子テーブル.列 | 参照先 | 必須／任意 | ON DELETE |
| --- | --- | --- | --- |
| `videos.user_id` | `users.id` | 任意（`guest_id` と排他） | CASCADE |
| `videos.source_id` | `sources.id` | 必須 | RESTRICT |
| `comments.video_id` | `videos.id` | 必須 | CASCADE |
| `comments.parent_comment_id` | `comments.id`（自己参照） | 任意 | CASCADE |
| `comment_analysis.comment_id` | `comments.id` | 必須 | CASCADE |
| `comment_analysis.group_id` | `comment_groups.id` | 任意 | SET NULL |
| `comment_groups.video_id` | `videos.id` | 必須 | CASCADE |
| `advice_logs.video_id` | `videos.id` | 必須 | CASCADE |
| `advice_logs.user_id` | `users.id` | 任意 | CASCADE |
| `users.id` | `auth.users.id` | 必須 | CASCADE |

- `videos.guest_id` と `advice_logs.guest_id` は外部キーを持たない。
- `ON DELETE` は【確定】。動画やユーザーを削除すると、それに属するデータが連鎖して削除される。
  - ゲストの24時間削除ジョブは、期限切れの `videos` 行を削除すれば、子テーブルも連鎖して削除される。
  - 例外は2つ。`videos.source_id` は RESTRICT（動画が残っている媒体は削除できない）、`comment_analysis.group_id` は SET NULL（グループが消えても分析結果は残す）。

### 関係の補足

- `sources` 1 — N `videos`：媒体ごとに動画を管理する。
- `videos` 1 — N `comments`：動画に複数のコメントが付く。
- `videos` 1 — N `comment_groups`：動画ごとにグループを持つ。
- `videos` 1 — N `advice_logs`：動画ごとにアドバイス履歴を持つ（生成単位は動画）。
- `comments` 1 — N `comment_analysis`：同じコメントの再分析履歴を複数保存できる（`is_latest` で最新を区別）。
- `comment_groups` 1 — N `comment_analysis`：グループに複数のコメントの分析結果が属する。
- `ng_words` は他テーブルと外部キーを持たない。ヒットした語は `comment_analysis.ng_words` に配列で保存する。

---

## 4. Enum・値の定義

### 4.1 `primary_category`（`comment_analysis.primary_category`）

| 値 | 意味 |
| --- | --- |
| `question` | 質問 |
| `feedback` | 改善につながる指摘・要望 |
| `praise` | 称賛・ポジティブ |
| `negative_opinion` | 否定的意見（攻撃性なし） |
| `harmful` | 攻撃的・誹謗中傷・NG |
| `spam` | スパム・宣伝 |
| `other` | 分類不能・雑談 |

### 4.2 `labels`（`comment_analysis.labels` の要素、`text[]`）

| 値 | 意味 |
| --- | --- |
| `positive` | ポジティブ要素を含む |
| `negative` | ネガティブ要素を含む |
| `question` | 質問要素を含む |
| `constructive_feedback` | 建設的な指摘・改善提案 |
| `request` | 要望 |
| `correction` | 誤り指摘・訂正 |
| `harassment` | 嫌がらせ |
| `insult` | 侮辱 |
| `threat` | 脅迫 |
| `spam` | スパム的要素 |
| `off_topic` | 話題と無関係 |

### 4.3 `group_type`（`comment_groups.group_type`）

| 値 | 意味 |
| --- | --- |
| `feedback_request` | 指摘・要望ランキングの対象 |
| `question` | 質問ランキングの対象 |

### 4.4 `triggered_by`（`advice_logs.triggered_by`）

| 値 | 意味 |
| --- | --- |
| `system` | 自動生成 |
| `user` | ユーザー操作による生成（MVPでは使わない） |

---

## 5. 各テーブル定義

### 5.1 videos（動画情報）

関連：要件定義書 3章、6章、13.2

| カラム | 型 | 必須 | FK | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | yes | PK | 主キー |
| `user_id` | uuid | no | → `users.id` | ログインユーザーID |
| `guest_id` | uuid | no | （FKなし） | ゲストのID（Cookie発行のUUID） |
| `source_id` | uuid | yes | → `sources.id` | 媒体 |
| `video_id` | text | yes | （YouTube側の外部ID） | APIで取得した動画ID。内部の `id` とは別物 |
| `title` | text | yes |  | 動画タイトル |
| `thumbnail_url` | text | no |  | サムネイルURL |
| `published_at` | timestamptz | no |  | 公開日時 |
| `created_at` | timestamptz | yes |  | レコード作成日時 |

**制約（確定）**

```sql
-- user_id と guest_id は、どちらか一方だけが入る
CHECK (
  (user_id IS NOT NULL AND guest_id IS NULL)
  OR (user_id IS NULL AND guest_id IS NOT NULL)
)
```

- ゲストの24時間削除ジョブは、`guest_id IS NOT NULL` かつ `created_at` が24時間を超えた行を対象にする。
- ログイン後の引継ぎは `UPDATE videos SET user_id = 新user_id, guest_id = NULL WHERE guest_id = Cookieの値`。
- 同じユーザーが同じ動画を複数回登録してもよい（`user_id` ＋ `source_id` ＋ `video_id` のユニーク制約は設けない）【確定】。

### 5.2 comments（コメント本体）

関連：要件定義書 7章、13.3

| カラム | 型 | 必須 | FK | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | yes | PK | 主キー |
| `video_id` | uuid | yes | → `videos.id` | 所属する動画 |
| `external_comment_id` | text | no |  | 媒体側のコメントID |
| `comment_text` | text | yes |  | コメント本文 |
| `author` | text | no |  | 投稿者名 |
| `like_count` | int | no |  | いいね等の数 |
| `body_hash` | text | no |  | `SHA-256(comment_text)`。再分析要否の判定に使う |
| `parent_comment_id` | uuid | no | → `comments.id`（自己参照） | `NULL`：親コメント。値あり：返信（親コメントの `id`） |
| `posted_at` | timestamptz | no |  | 投稿日時（媒体側の値） |
| `created_at` | timestamptz | yes |  | レコード作成日時 |
| `updated_at` | timestamptz | yes |  | `DEFAULT now()`。UPDATE時にトリガーで自動更新する（本文変更検知のUPDATEを含む） |

- `raw_payload`（YouTube APIの生データ）は持たない。
- YouTube APIが返す親コメントの `external_comment_id` は、内部の `parent_comment_id`（uuid）とは別物。保存時に `external_comment_id` から内部の `id` への変換が必要。

### 5.3 comment_analysis（AI分析結果）

関連：要件定義書 8章、9章、10章、13.4

| カラム | 型 | 必須 | FK | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | yes | PK | 主キー |
| `comment_id` | uuid | yes | → `comments.id` | 分析対象のコメント |
| `is_latest` | boolean | yes |  | 最新の分析結果か。`DEFAULT true` |
| `analyzed_at` | timestamptz | yes |  | 分析実行時刻 |
| `primary_category` | enum | yes |  | 主分類（4.1参照）。タブ振り分けと件数集計に使う |
| `labels` | text[] | yes |  | 属性タグ（4.2参照）。複数付与可。該当なしは空配列 |
| `ng_words` | text[] | no |  | 実際にヒットしたNGワードの一覧 |
| `score` | numeric(3,2) | no |  | `primary_category` の判定確信度（0.00〜1.00） |
| `review_required` | boolean | no | | 人のレビューが必要か（条件は要件定義書9.2） |
| `group_id` | uuid | no | → `comment_groups.id` | 所属グループ。グループ対象外のコメント（`harmful` / `spam` を含む）は `NULL`。1コメントにつき最大1グループ |
| `embedding` | vector(1536) | no |  | コメント本文のEmbedding変換後の値（`text-embedding-3-small`）。対象外は `NULL` |
| `created_at` | timestamptz | yes |  | レコード作成日時 |

- `actionable_flag`、`actionable_score`、`actionable_reason` は持たない【確定】。建設的な指摘の抽出は、`primary_category` と `labels` で行う（要件定義書10.1）。

**運用ルール（確定）**

- 再分析時は、既存行を `is_latest = false` に更新し、新しい結果を `is_latest = true` で新規INSERTする。履歴は削除しない。
- 現在の分析結果は、常に `WHERE comment_id = X AND is_latest = true` で取得する。
- `embedding` は、要件定義書10.1のグループ対象になるコメントのみ生成する（`harmful` / `spam` は対象外）。

### 5.4 comment_groups（類似コメントのグループ）

関連：要件定義書 10章、11章、13.9

| カラム | 型 | 必須 | FK | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | yes | PK | 主キー |
| `video_id` | uuid | yes | → `videos.id` | 所属する動画 |
| `group_type` | enum | yes |  | どちらのランキングの対象か（4.3参照） |
| `representative_text` | text | yes |  | LLMが生成する代表論点のテキスト（例：「音声・ナレーションが聞き取りづらい」） |
| `representative_embedding` | vector(1536) | yes |  | 新規コメントとの類似度比較の基準値。新規グループ作成時点のコメントのembeddingをそのまま格納する |
| `comment_count` | integer | yes |  | グループに属するコメント数（ランキングのソートキー） |
| `created_at` | timestamptz | yes |  | レコード作成日時 |
| `updated_at` | timestamptz | yes |  | レコード更新日時 |

- 類似度の閾値は0.82。LLMは、新規グループ作成時の `representative_text` 生成にのみ使う。
- `representative_embedding` は、既存グループへの合流時に更新しない【確定】。
- 1コメントが所属するグループは1つだけ。`primary_category = 'question'` なら `question`、それ以外で `feedback` または `labels` に `request` を含めば `feedback_request`（要件定義書10.1）。

### 5.5 ng_words（NGワード辞書）

関連：要件定義書 9.2、13.5

| カラム | 型 | 必須 | FK | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | yes | PK | 主キー |
| `word` | text | yes |  | NGワード（単語／フレーズ） |
| `category` | text | no |  | 差別／誹謗／暴力／性的 など |
| `severity` | int | no |  | 危険度（1〜5）。5は即 `harmful` 確定、1〜4はLLMへのヒント |
| `normalized` | text | no |  | 正規化表現（検索用） |
| `created_at` | timestamptz | yes |  | レコード作成日時 |

- 初期データは `supabase/seed.sql` で管理する（このファイルには実データを載せない）。
- 有効／無効の管理（`is_active` など）は【未決定】。

### 5.6 advice_logs（アドバイス生成履歴）

関連：要件定義書 12章、13.6

| カラム | 型 | 必須 | FK | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | yes | PK | 主キー |
| `video_id` | uuid | yes | → `videos.id` | 対象の動画（生成単位は1動画につき1アドバイス） |
| `advice_text` | text | yes |  | AIが生成したアドバイス全文 |
| `advice_summary` | text | yes |  | 要約（UI表示用） |
| `triggered_by` | enum | yes |  | 生成のきっかけ（4.4参照）。MVPでは常に `system` |
| `model_version` | text | no |  | 使用したモデル名／バージョン |
| `user_id` | uuid | no | → `users.id` | `triggered_by = 'user'` かつログインユーザーの場合のみ設定。それ以外は `NULL` |
| `guest_id` | uuid | no | （FKなし） | `triggered_by = 'user'` かつゲストの場合のみ設定。それ以外は `NULL` |
| `generated_at` | timestamptz | yes |  | AIがアドバイスを生成した時刻 |
| `created_at` | timestamptz | yes |  | レコード作成日時（DB保存時刻） |

- 再生成時は既存行を上書きせず、新しい行をINSERTして履歴を残す。
- 「最新のアドバイス」は、`video_id` ＋ `generated_at` の降順で取得する。

### 5.7 users（ログインユーザー）

関連：要件定義書 3.2、13.7

| カラム | 型 | 必須 | FK | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | yes | → `auth.users.id` | `auth.users.id` と同じ値 |
| `name` | text | no |  | 表示名 |
| `role` | text | yes |  | `'admin'` または `'user'`。`DEFAULT 'user'` |
| `created_at` | timestamptz | yes |  | レコード作成日時 |

- Supabase Authとの同期方式、追加のプロフィール項目は【未決定】。

### 5.8 sources（媒体情報）

関連：要件定義書 2.1、13.8

| カラム | 型 | 必須 | FK | 説明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | yes | PK | 主キー |
| `name` | text | yes |  | 媒体名。MVPは `'youtube'` のみ（将来：tiktok、instagram、x） |
| `base_url` | text | no |  | APIやページのベースURL |
| `api_notes` | text | no |  | 任意の運用メモ（認証方式、レート制限、ページング方式、サムネイルURLのパターン等） |
| `created_at` | timestamptz | yes |  | レコード作成日時 |

- `api_notes` は必須ではないが、実装やデバッグのメモとして使えるため残す。

---

## 6. インデックス

要件定義書13.10のとおり、FK列には基本的にインデックスを張る。

### 6.1 個別に定義するもの【確定】

| インデックス名 | テーブル | 対象列 | 種類 | 目的 |
| --- | --- | --- | --- | --- |
| `idx_comment_analysis_latest` | `comment_analysis` | `comment_id`, `is_latest` | 複合 | 「現在の分析結果」の取得を高速化する |
| `idx_videos_guest_id_unique` | `videos` | `guest_id` | 部分ユニーク | ゲストの1動画制限をDBレベルでも保証する |
| `idx_comments_video_external_unique` | `comments` | `video_id`, `external_comment_id` | 複合ユニーク | 同じコメントの重複登録を防ぐ（要件定義書7.4） |
| `idx_comment_analysis_latest_unique` | `comment_analysis` | `comment_id`（`WHERE is_latest`） | 部分ユニーク | 同じコメントで最新の分析結果を1行に保つ |

```sql
-- ゲストの1動画制限をDBレベルでも保証する
CREATE UNIQUE INDEX idx_videos_guest_id_unique
ON videos(guest_id)
WHERE guest_id IS NOT NULL;
```

```sql
-- 同じコメントの重複登録を防ぐ
CREATE UNIQUE INDEX idx_comments_video_external_unique
ON comments(video_id, external_comment_id);

-- 同じコメントで is_latest = true の行を1つだけにする
CREATE UNIQUE INDEX idx_comment_analysis_latest_unique
ON comment_analysis(comment_id)
WHERE is_latest;
```

- `external_comment_id` が `NULL` の行は、PostgreSQLの仕様上、ユニーク制約の対象にならない。

### 6.2 FK列のインデックス

| テーブル | 対象列 |
| --- | --- |
| `videos` | `user_id`, `source_id` |
| `comments` | `parent_comment_id`（`video_id` は6.1のユニークインデックスの先頭列で対応） |
| `comment_analysis` | `group_id`（`comment_id` は6.1の複合インデックスで対応） |
| `comment_groups` | `video_id` |
| `advice_logs` | `video_id`, `user_id` |

---

## 7. 未決定・要確認事項

### 7.1 未決定

- `ng_words` の有効／無効の管理
- `users` とSupabase Authの同期方式、追加のプロフィール項目
- `videos` の追加項目
- AI利用量、トークン数、推定費用の記録先（専用テーブルか、ログ出力か）

### 7.2 要確認

現在、要確認の事項はない。
