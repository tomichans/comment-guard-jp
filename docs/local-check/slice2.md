# スライス2 ローカルでの動作確認

対象：PR #2（ブランチ `claude/project-thread-f79c63`）

スライス2では、まだ画面（URL入力欄やコメント一覧）を作っていません。そのため確認は、**ブラウザの開発者ツールの「コンソール」から API を呼び出す**方法で行います。コンソールに貼り付けて Enter を押すだけで、ログイン状態や Cookie もブラウザがそのまま扱ってくれます。

## 確認できること

| # | 確認すること | YouTube APIキー |
| --- | --- | --- |
| 1 | 自動テスト（71件）がすべて通る | 不要 |
| 2 | 不正なURLを入れるとエラーになる | 不要 |
| 3 | ゲストが動画を登録すると、コメントが最大100件保存される | 必要 |
| 4 | ゲストの2本目はエラーになる（同時に1本まで） | 必要 |
| 5 | ログインユーザーは、残りのコメント（最大1000件まで）が後から取得される | 必要 |
| 6 | 存在しない動画はエラーになり、動画は作られない | 必要 |
| 7 | 同じIPからの登録回数の上限（仮で5回）に達するとエラーになる | 必要 |
| 8 | API使用量が `api_usage_logs` テーブルに記録されている | 必要 |

---

## 0. 準備（最初に1回）

```bash
git fetch origin
git switch claude/project-thread-f79c63
npm install
npm run db:start      # Docker が起動している必要がある
npm run db:reset      # 今回追加したマイグレーションを適用する（ローカルのデータは消える）
```

`.env.local` に、次の2行を追加します（他の行はスライス1のまま）。

```
YOUTUBE_API_KEY=（Google Cloud で発行したキー。取り方は README の「YouTube APIキーの取得」）
IP_HASH_SECRET=（openssl rand -hex 32 の出力など、ランダムな文字列）
```

最後に開発サーバーを起動します。

```bash
npm run dev           # http://localhost:3000
```

### コンソールの開き方

1. Chrome で http://localhost:3000 を開く
2. 右クリック →「検証」→「Console」タブ
3. 初めて貼り付けるときは、警告が出たら `allow pasting` と入力して Enter（Chrome の安全機能）

以下の手順で `動画のURL` と書いた部分は、コメントが100件以上ある公開動画のURLに置き換えてください。

---

## 1. 自動テスト（APIキー不要）

```bash
npm test
```

`Tests  71 passed` と出れば成功です。YouTube の代わりに偽物の応答を使い、上の 3〜8 と同じ内容をまとめて確かめています。

## 2. 不正なURL（APIキー不要）

ログアウトした状態で、コンソールに貼り付けます。

```js
const res = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://example.com" }) });
console.log(res.status, await res.json());
```

期待する結果：`400` と `invalid_url`、「YouTubeの動画URLを入力してください…」というメッセージ。

## 7. IP単位の上限（先にやるのがおすすめ）

ゲストが動画を1本持つと「2本目はエラー」が先に出てしまうため、この確認は **動画を登録する前** に行います。存在しない動画IDを6回送ります（YouTube のクォータを6ユニット使います）。

```js
for (let i = 1; i <= 6; i++) {
  const res = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://youtu.be/aaaaaaaaaaa" }) });
  console.log(i, res.status, (await res.json()).error);
}
```

期待する結果：1〜5回目は `404 video_not_found`、6回目は `429 guest_daily_limit`。

終わったら、上限を元に戻します。Supabase Studio（http://127.0.0.1:54323）→「SQL Editor」で次を実行します。

```sql
delete from api_usage_logs;
```

## 3. ゲストの登録

ログアウトした状態で：

```js
const res = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "動画のURL" }) });
const data = await res.json();
console.log(res.status, data);
const videoId = data.video.id;
```

期待する結果：`201`。`video.title` に動画のタイトル、`fetch_status` は `"done"`。

続けてコメントの件数を見ます。

```js
const c = await (await fetch(`/api/videos/${videoId}/comments`)).json();
console.log(c.comments.length);
```

期待する結果：親コメント100件と、それに付いた返信の合計（100より多いことがあります）。

あわせて、開発者ツールの「Application」→「Cookies」→ `http://localhost:3000` に `guest_id` があり、「HttpOnly」にチェックが付いていることも確認できます。

## 4. ゲストの2本目

3 の直後に、同じコードをもう一度実行します。

期待する結果：`409` と `guest_video_limit`、「ゲストは同時に1本までです…」。

## 6. 存在しない動画

URLを `https://youtu.be/aaaaaaaaaaa` にして 3 のコードを実行します（2本目のエラーを避けるため、シークレットウィンドウで行ってください）。

期待する結果：`404` と `video_not_found`。Studio の `videos` テーブルに、新しい行は増えません。

## 5. ログインユーザーの残りの取得

1. http://localhost:3000/signup でアカウントを作る（メール確認はないので、すぐにログインできます）
2. コメントが100件より多い動画（できれば数百件以上）で、3 と同じコードを実行する

期待する結果：`201` で、`fetch_status` は `"fetching"`。数秒待ってから、次を実行します。

```js
const v = await (await fetch(`/api/videos/${videoId}`)).json();
console.log(v.video.fetch_status);
const c = await (await fetch(`/api/videos/${videoId}/comments`)).json();
console.log(c.comments.length);
```

期待する結果：`fetch_status` が `"done"` に変わり、コメントが100件より多くなっています（親コメントは最大1000件）。

なお、ゲストで登録した動画は、このアカウントでログインした時点で自動的に引継がれます（スライス1の機能）。

## 8. API使用量の記録

Studio（http://127.0.0.1:54323）→「Table Editor」→ `api_usage_logs` を開きます。

期待する結果：
- 1回の登録につき、`videos.list` が1行と、`commentThreads.list` が取得したページの数だけ並ぶ
- ゲストの行には `guest_id` と `ip_hash`（64文字の英数字。IPアドレスそのものではない）が入る
- ログインユーザーの行には `user_id` が入り、`ip_hash` は空
- YouTube がエラーを返した呼び出し（APIキーの誤り、コメント無効、クォータ超過など）は `succeeded` が `false`
  - 存在しない動画（7 や 6）は `true` になる。YouTube は「該当なし」という空の結果を正常に返しており、呼び出し自体は成功しているため
  - `false` を確かめたいときは、`.env.local` の `YOUTUBE_API_KEY` をわざと1文字変えて `npm run dev` を再起動し、登録を試す（終わったら元に戻す）

---

## うまくいかないとき

| 症状 | 原因と対処 |
| --- | --- |
| `500` エラーで、ターミナルに「環境変数 YOUTUBE_API_KEY が設定されていません」 | `.env.local` に追記してから、`npm run dev` を起動し直す |
| `502 youtube_error` | `npm run dev` のターミナルに出る `[youtube] API がエラーを返しました` の `detail` を見る。`API_KEY_INVALID`＝キーの誤り、`SERVICE_DISABLED`＝YouTube Data API v3 が無効、`API_KEY_HTTP_REFERRER_BLOCKED` など `BLOCKED` で終わるもの＝キーの「アプリケーションの制限」が原因。`[youtube] 通信に失敗しました` なら、ネットワーク（プロキシ・セキュリティソフト）の問題 |
| `503 quota_exceeded` | その日の無料枠（10,000ユニット）を使い切った。日本時間の夕方（太平洋時間の0時）に戻る |
| `fetch_status` がずっと `"fetching"` | 開発サーバーのターミナルに `[fetch-comments]` で始まるエラーが出ていないか確認する |
| Studio に `api_usage_logs` がない | `npm run db:reset` を実行していない |
