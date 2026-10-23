# 動画削除API ローカルでの動作確認

対象：PR #3（ブランチ `claude/project-thread-myy1hw`）

まだ画面に削除ボタンはないので、スライス2と同じく **ブラウザの開発者ツールの「コンソール」から API を呼び出して** 確かめます。

## 確認できること

| # | 確認すること | YouTube APIキー |
| --- | --- | --- |
| 1 | 自動テスト（78件）がすべて通る | 不要 |
| 2 | 未ログイン（ゲスト）は削除できない（403） | 不要 |
| 3 | ログインユーザーは自分の動画を削除でき、コメントも消える | 必要 |
| 4 | もう一度削除しようとすると 404 | 必要 |
| 5 | 他人の動画は削除できない（404） | 必要 |

---

## 0. 準備

```bash
git fetch origin
git switch claude/project-thread-myy1hw
npm run db:start      # Docker が起動している必要がある
npm run dev           # http://localhost:3000
```

今回はDBの変更がないので、`npm run db:reset` は不要です。`.env.local` もスライス2のままで大丈夫です。

## 1. 自動テスト

```bash
npm test
```

`Tests  78 passed` と出れば成功です。他人・ゲスト・期限切れの動画を削除できないこと、削除するとコメントや分析結果まで消えることなどを確かめています。

## 2. 未ログインは削除できない

ログアウトした状態（またはシークレットウィンドウ）で、コンソールに貼り付けます。

```js
const res = await fetch("/api/videos/00000000-0000-0000-0000-000000000000", { method: "DELETE" });
console.log(res.status, await res.json());
```

期待する結果：`403` と `login_required`、「動画の削除は、ログインすると利用できます」。

ゲストとして動画を持っている場合に、その動画の ID を入れても同じ 403 になります。

## 3. 自分の動画を削除する

ログインした状態で、まず動画を1本登録します（スライス2の手順3と同じ）。

```js
const res = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "動画のURL" }) });
const videoId = (await res.json()).video.id;
console.log(videoId);
```

続けて削除します。

```js
const del = await fetch(`/api/videos/${videoId}`, { method: "DELETE" });
console.log(del.status);
```

期待する結果：`204`（中身なし）。

Studio（http://127.0.0.1:54323）の「Table Editor」で、`videos` にその ID の行がなく、`comments` にもその動画のコメント（`video_id` がその ID の行）が残っていないことを確認できます。`api_usage_logs` の記録は、設計どおり残ります。

## 4. もう一度削除する

3 の直後に、削除のコードをもう一度実行します。

期待する結果：`404` と `not_found`。

## 5. 他人の動画は削除できない

1. アカウントAでログインし、動画を登録して `videoId` を控える
2. ログアウトして、別のアカウントB を http://localhost:3000/signup で作る
3. アカウントBで、控えた ID を使って削除のコードを実行する

```js
const del = await fetch("/api/videos/（控えたID）", { method: "DELETE" });
console.log(del.status, await del.json());
```

期待する結果：`404` と `not_found`（「他人の動画です」とは返さず、存在しない動画と同じ扱い）。Studio で、アカウントAの動画が残っていることも確認できます。

---

## うまくいかないとき

| 症状 | 原因と対処 |
| --- | --- |
| ログインしているのに `403` | ログインの Cookie が切れている。http://localhost:3000/login でログインし直す |
| `405 Method Not Allowed` | 古いブランチのまま `npm run dev` している。ブランチを切り替えて起動し直す |
