# デプロイの手順

CommentGuard JP を、インターネットに公開する手順です。上から順に行えば終わるように書いています（1〜2時間の見込み）。

- 公開先：**Vercel**（アプリ）と **Supabase**（DB・認証）。どちらも無料のプランで動きます。
- 秘密の値（APIキーなど）は、各サービスの画面にだけ入れます。Git やチャットには書きません。
- セキュリティの確認は [docs/security-checklist.md](security-checklist.md)（以下「チェックリスト」）にまとめてあり、この手順の途中で「チェックリストの◯を行う」と案内します。

## 全体の流れ

| 手順 | すること | 場所 |
| --- | --- | --- |
| 0 | 事前の確認（npm audit、GitHub の設定） | 手元の PC、GitHub |
| 1 | 本番の Supabase を作る | Supabase の画面 |
| 2 | 本番の DB に、表と初期データを入れる | 手元の PC |
| 3 | 本番用の APIキー・秘密の値を用意する | Google Cloud、OpenAI、手元の PC |
| 4 | Vercel にアプリを載せる | Vercel の画面 |
| 5 | Supabase に公開URLを登録する | Supabase の画面 |
| 6 | 期限切れ削除ジョブを登録する | Supabase の SQL Editor |
| 7 | 公開後の確認 | 手元の PC、ブラウザ |

---

## 0. 事前の確認

1. 手元の main を最新にする（`git switch main && git pull`）。
2. チェックリストの **1.1（npm audit）** と **1.4（GitHub の Dependabot alerts、Secret scanning）** を行う。

## 1. 本番の Supabase を作る

1. [Supabase](https://supabase.com/dashboard) で **New project** を押す。
   - Name：`comment-guard-jp`
   - Database Password：**Generate a password** で作り、パスワード管理アプリなどに控える（手順2で使う）
   - Security の3つのチェック：**Enable Data API** ON、**Automatically expose new tables** ON のまま、**Enable automatic RLS** ON
     - Data API は、ログインや、ログインユーザーが自分の動画を読む・消す処理に要る。
     - 「expose new tables」は、Supabase は OFF を勧めているが、このリポジトリのマイグレーションには表への権限を付ける文がないので、OFF にすると「permission denied」で動かなくなる。全部の表で RLS を有効にしてあるので、ON のままでも他人のデータは読めない。
   - Region：**Northeast Asia (Tokyo)**（アプリを動かす Vercel の地域と同じ東京にする。遠いと、DB とのやり取りのたびに待ち時間が増えるため）
   - Plan：Free
2. 作成が終わったら、チェックリストの **1.3** を行う。
   - Authentication → Sign In / Providers → Email：「Confirm email」を**オフ**、「Minimum password length」を **8**
   - Security Advisor は、手順2で表を入れた後に見る
3. Project Settings → **API Keys** を開き、次の3つを控える（手順4で Vercel に入れる）。

   | 控える値 | 画面での名前 | Vercel での変数名 |
   | --- | --- | --- |
   | プロジェクトのURL | Project URL（Project Settings → Data API など）。**`https://<project-ref>.supabase.co` だけ**にし、後ろの `/rest/v1` や `/` は付けない | `NEXT_PUBLIC_SUPABASE_URL` |
   | 公開用の鍵 | **Publishable key**（`sb_publishable_…`）。Legacy タブの `anon` でもよい | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | 管理用の鍵 | **Secret key**（`sb_secret_…`）。Legacy タブの `service_role` でもよい | `SUPABASE_SERVICE_ROLE_KEY` |

   - 管理用の鍵は、RLS を無視して全データを読み書きできる。Vercel の環境変数以外には貼らない。

> 補足：無料プランの Supabase は、7日間使われないと一時停止します。1時間ごとの削除ジョブ（手順6）がアプリ経由で DB を使うので、止まりにくいはずです。止まったときは、Supabase の画面の **Restore** で再開できます。

## 2. 本番の DB に、表と初期データを入れる

手元の PC の、このリポジトリのフォルダで実行します。

```bash
# Supabase CLI にログインする（ブラウザが開く）
npx supabase login

# 本番のプロジェクトとつなぐ。<project-ref> は、Supabase の URL の https://<project-ref>.supabase.co の部分。
# 手順1で控えた Database Password を聞かれる。
npx supabase link --project-ref <project-ref>

# どのマイグレーションが入るかを、先に確かめる（何も変えない）
npx supabase db push --dry-run

# マイグレーション（supabase/migrations/）と、初期データ（supabase/seed.sql：sources と NGワード）を入れる
npx supabase db push --include-seed
```

- 終わったら、Supabase の画面の **Table Editor** で、`sources` に youtube が1行、`ng_words` に10行あることを確かめる。
- SQL Editor で、次を1回実行する（手順1で「Enable automatic RLS」を ON にした場合）。

  ```sql
  revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  ```

  - `rls_auto_enable()` は、そのチェックを ON にしたときに Supabase が自動で作る関数（新しい表に RLS を自動で付ける）。API から呼べる状態だと、Security Advisor が警告を2つ出す。呼べないようにしても、RLS を自動で付ける動きは変わらない。
- **Advisors → Security Advisor** を開き（Refresh を押す）、警告（WARN）がないことを確かめる（チェックリスト1.3の後半）。警告が出たら、内容を Claude に貼って相談する。
  - 次の3件の情報（INFO「RLS Enabled No Policy」）は、**意図したもの**なので、対応しなくてよい：`api_usage_logs`、`ng_words`、`sources`。この3つの表は、サーバーだけが読み書きし、ブラウザからは一切読ませない。ポリシーを作らないことで「誰にも読めない」状態にしている（要件定義書13.2、16章）。
  - `handle_new_auth_user()`（サインアップ時に `users` の行を作るトリガー用の関数）の警告2件は、マイグレーション `20261118000001_revoke_trigger_function_execute.sql` が解消する。このマイグレーションが入る前に本番へ `db push` した場合は、SQL Editor で `revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;` を実行しても同じ。
- `--include-seed` でエラーになった場合は、`supabase/seed.sql` の中身を SQL Editor に貼って Run しても同じです。

## 3. 本番用の APIキー・秘密の値を用意する

ローカル用とは別に、本番用を作ります（漏れたときに、本番の分だけ止められるようにするため）。

| 値 | 作り方 | 変数名 |
| --- | --- | --- |
| YouTube の APIキー | Google Cloud の「認証情報」で新しく発行し、YouTube Data API v3 だけに制限する（README「YouTube APIキーの取得」） | `YOUTUBE_API_KEY` |
| OpenAI の APIキー | OpenAI の「API keys」で、名前を `comment-guard-prod` などにして新しく発行する | `OPENAI_API_KEY` |
| 削除ジョブの合言葉 | 手元で `openssl rand -hex 32` を実行して出た文字列 | `CRON_SECRET` |
| IP の変換用の鍵 | もう一度 `openssl rand -hex 32` を実行して出た、別の文字列 | `IP_HASH_SECRET` |

- OpenAI の **Limits** で、月の利用額の上限を設定する（例：5ドル。チェックリスト2.3）。アプリの利用上限（1日50本）が働かなかったときの、最後の歯止めです。
- `CRON_SECRET` は手順6でも使うので、手順6が終わるまで控えておく。
- チェックリスト **1.2** の「`.env.local` が Git に入っていないこと」を、ここで確かめる（`git status` に出ない）。

## 4. Vercel にアプリを載せる

1. [Vercel](https://vercel.com/) に GitHub でログインし、**Add New… → Project** を押す。
2. `tomichans/comment-guard-jp` の **Import** を押す（一覧に出ないときは、「Adjust GitHub App Permissions」でこのリポジトリへのアクセスを許可する）。
3. Framework Preset が **Next.js** になっていることを確かめる。ビルドのコマンドなどは変えない。
4. **Environment Variables** に、`.env.example` の変数を入れる。

   | 変数名 | 値 |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | 手順1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 手順1（Publishable key） |
   | `SUPABASE_SERVICE_ROLE_KEY` | 手順1（Secret key） |
   | `CRON_SECRET` | 手順3 |
   | `YOUTUBE_API_KEY` | 手順3 |
   | `IP_HASH_SECRET` | 手順3 |
   | `OPENAI_API_KEY` | 手順3 |

   - `OPENAI_CLASSIFY_MODEL` と `OPENAI_ADVICE_MODEL` は入れない（空なら、コードの既定のモデルを使う）。
   - 種類（Type）は、`NEXT_PUBLIC_` で始まる2つを **Config**、残りを **Secret** にする。`NEXT_PUBLIC_` の値はブラウザにも渡る決まりなので、Vercel は Secret にさせない（赤い警告が出る）。この2つは公開されても困らない値（安全は RLS で守っている）。Secret は保存後に値を見られず、Config には後から変えられない。
   - `SUPABASE_SERVICE_ROLE_KEY` には、`NEXT_PUBLIC_` を付けない（ブラウザに公開されてしまう）。
   - 環境（Environments）は **Production だけ**にする。Preview にも入れると、確認前のコードが本番の DB と APIキーを使えてしまうため。
5. **Deploy** を押す。2〜3分でビルドが終わり、`https://comment-guard-jp-xxxx.vercel.app` のような公開URLが出る。
6. 公開URLを控える（手順5〜7と README で使う）。

このリポジトリの設定（`vercel.json`）で、次の2つを決めています。画面での設定は要りません。

- サーバーの処理を **東京（`hnd1`）** で動かす。Vercel の既定はアメリカ東部で、東京の Supabase とのやり取りに毎回時間がかかるため。
- **main 以外（Pull Request など）のビルドをしない**（`ignoreCommand`）。本番用の環境変数を Production だけに入れているので、それ以外のビルドは動かないうえ、確認前のコードを公開しないため。
  - Vercel の画面で、PR のデプロイが「Canceled（Ignored Build Step）」と出るのは、この設定によるもので、正常です。
  - 判定は「プレビューだと分かるとき」か「main 以外のブランチだと分かるとき」だけビルドを止め、分からないときはビルドする。当初は `[ "$VERCEL_ENV" != "production" ]` にしていたが、この判定のときに `VERCEL_ENV` が空のことがあり、**本番のビルドまで止まって、デプロイが1件も出なかった**（2026-11-21）。

以後は、**main にマージするたびに、自動で公開し直されます**。

## 5. Supabase に公開URLを登録する

Supabase の Authentication → **URL Configuration** を開く。

- Site URL：手順4の公開URL（`https://…vercel.app`）
- Redirect URLs：同じURLの後ろに `/**` を付けたもの（`https://…vercel.app/**`）

メールの確認は使っていないので、今の機能では使われませんが、パスワードの再設定などを後で足したときに、ローカルの URL（127.0.0.1）へ飛ばないようにするためです。

## 6. 期限切れ削除ジョブを登録する

YouTube の規約で、取得したデータは30日以内に消す必要があります（要件定義書3.3）。1時間ごとに削除の API を呼ぶジョブを登録します。

1. Supabase の **SQL Editor** を開き、[supabase/production/schedule-purge-expired.sql](../supabase/production/schedule-purge-expired.sql) の中身を貼る。
2. SQL Editor の上で、次の2か所を書き換える（**ファイルは書き換えない**。秘密が Git に入るため）。
   - `https://（公開URL。末尾の / なし）` → 手順4の公開URL
   - `（Vercel に入れた CRON_SECRET と同じ値）` → 手順3の `CRON_SECRET`
3. **Run** を押す。
4. すぐに動くかを試す（次の0分を待たずに確かめる）。手元で次を実行する。

   ```bash
   curl -s -H "Authorization: Bearer （CRON_SECRET）" https://（公開URL）/api/cron/purge-expired
   ```

   `{"videos":0,"usageLogs":0}` のような JSON が返ればよい（数は、消した件数）。合言葉が違うと `{"error":"unauthorized"}` になる。
5. 1時間ほどたってから、ファイルの末尾の「確かめ方」の SQL を実行し、ジョブが動いて 200 が返っていることを確かめる。

## 7. 公開後の確認

1. チェックリストの **2.1（ヘッダー）** と **2.2（ゲストのデータが外から読めないか）** を行う。
2. 画面で、一通り動かす。
   - ゲストで動画を1本分析し、タブ・ランキング・AIアドバイスが出る
   - 「＋新しい動画」で、登録の案内（ゲストは1本まで）が出る
   - サインアップ（8文字以上のパスワード）すると、ゲストの動画が引き継がれる
   - ログインユーザーで動画を削除できる
   - 利用規約・プライバシーポリシーが開ける
3. Supabase の Table Editor で、`api_usage_logs` に記録が増えていることを確かめる。
4. 公開URLを Claude に伝える（README に書き足す）。

## うまくいかないとき

| 症状 | 見るところ |
| --- | --- |
| ビルドが失敗する | Vercel の Deployments → 失敗したデプロイ → Build Logs |
| Deployments が空のまま（「No Production Deployment」）。Create Deployment や Deploy Hook でも出ない | `main` に何かマージすると、Git の連携で自動デプロイが始まる。それでも出ないときは、GitHub の Settings → Integrations → GitHub Apps → Vercel で、このリポジトリへのアクセスを許可しているか確かめる |
| 画面が「環境変数 … が設定されていません」で止まる | Vercel の Settings → Environment Variables（入れ忘れ、Production 以外に入れた）。直したら Deployments → Redeploy |
| 動画の登録でエラーになる | Vercel の Logs（**1時間**で消えるので、起きたらすぐ見る）。YouTube・OpenAI の APIキーの制限 |
| Supabase とのやり取りで `PGRST125`（Invalid path specified in request URL） | `NEXT_PUBLIC_SUPABASE_URL` の末尾に `/rest/v1` などが付いている。`https://<project-ref>.supabase.co` だけにして、Redeploy する |
| ログイン・サインアップできない | Supabase の Authentication の設定（手順1、5） |

ログの残る期間：Vercel の Logs は1時間、Supabase のログは1日です（無料プラン）。API の利用量と費用、失敗した呼び出しは `api_usage_logs` に90日残ります（要件定義書17.2）。
