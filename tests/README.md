# テストの読み方

このフォルダのテストは [Vitest](https://vitest.dev/) で書いています。`npm test` で全部を実行します（ローカルの Supabase を `npx supabase start` で起動しておくこと）。

## 1. テストの形

どのテストも、次の形をしています。

```ts
describe("まとまりの名前", () => {      // 関係するテストをまとめる箱
  afterAll(cleanup);                     // 箱のテストが全部終わったら、作ったデータを消す

  it("確かめたいこと（日本語の文）", async () => {
    // 準備：テストに必要なデータを作る
    const { video } = await createGuestVideo(["最高でした"]);

    // 実行：確かめたい関数を呼ぶ
    await analyzeVideoComments(video, { ai: fakeAi() });

    // 確認：結果が期待どおりかを expect で比べる
    expect(await analysisStatusOf(video.id)).toBe("done");
  });
});
```

- `it("…")` の文が、そのテストで確かめていること。テストが失敗すると、この文が表示されます。
- 「準備 → 実行 → 確認」の順に読むと、何を確かめているのかが分かります。

## 2. よく出てくる expect

| 書き方 | 意味 |
| --- | --- |
| `expect(a).toBe(b)` | `a` と `b` が同じ値（数や文字）か |
| `expect(a).toEqual(b)` | 配列やオブジェクトの中身が、すべて同じか |
| `expect(a).toMatchObject(b)` | `a` が `b` に書いた項目を持っているか（書いていない項目は見ない） |
| `expect(a).toHaveLength(n)` | 配列の長さが `n` か |
| `expect(a).toBeNull()` | `a` が `null` か（このアプリでは「見つからない」の意味が多い） |
| `await expect(promise).rejects.toMatchObject(b)` | 関数がエラーで失敗し、そのエラーが `b` を持っているか |
| `it.each([...])("…%s", (x) => …)` | 同じテストを、値を変えて何回も実行する |

## 3. 偽物（テスト用の代役）

本物の YouTube や OpenAI に問い合わせると、APIキーと費用が必要で、結果も毎回変わります。そこで、決まった答えを返す偽物を使います。

- `helpers/fake-youtube.ts`：偽物の YouTube。`page("p1", 100, "NEXT")` は「100スレッドあり、続きがある」ページ。
- `helpers/fake-ai.ts`：偽物の AI。本文に「？」があれば質問、「してほしい」があれば指摘・要望、それ以外はポジティブ。「攻撃」を含むと Moderation API が攻撃的と判定します。

アプリの関数は、引数で渡された YouTube や AI を使うように作ってあります。本番では本物を、テストでは偽物を渡します（「依存性の注入」と呼ばれる書き方）。

## 4. DB のヘルパー（`helpers/db.ts`）

| 名前 | すること |
| --- | --- |
| `admin` | RLS を無視して何でも読み書きできる Supabase クライアント。データの準備と確認に使う |
| `insertVideo({ guestId })` / `insertVideo({ userId })` | 動画を1本作る。`createdAt` で作成日時、`analysisStatus` で分析の状況も決められる |
| `insertChildren(videoId)` | 動画に、コメント・分析結果・グループ・アドバイスを1行ずつ作る |
| `createTestUser()` | ログインユーザーを作り、そのユーザーとしてログインしたクライアントを返す |
| `newGuestId()` | 新しいゲストの ID を作る |
| `exists(table, id)` | その行が DB に残っているか |
| `cleanup()` | テストで作ったユーザーとゲストのデータを消す |

時刻のヘルパー（`HOUR_MS`、`DAY_MS`、`ago()`）は `helpers/time.ts` にあります。

## 5. おすすめの読む順番

やさしい順に並べています。上の3つは DB を使わない「関数に値を入れて、出てきた値を比べる」だけのテストです。

1. `youtube-url.test.ts`：URL から動画IDを取り出す。`it.each` の例
2. `retention.test.ts`：保持期間の判定。境界（ちょうど24時間）の前後を確かめる例
3. `analysis-rules.test.ts`：NGワードの判定と、最終的な分類の決め方
4. `youtube-client.test.ts`：YouTube の応答をアプリの形に変換する
5. `guest-limit.test.ts`：DB の制約（ユニーク・CHECK）がエラーを出すことを確かめる
6. `access-guest.test.ts`：ゲストAがゲストBのデータを読めないこと（要件定義書0.3で必須のテスト）
7. `access-user-rls.test.ts`：ログインユーザーの RLS
8. `retention-read.test.ts`、`purge-expired.test.ts`、`migrate-guest.test.ts`、`delete-video.test.ts`：保持期間と削除・引継ぎ
9. `comment-threads.test.ts`：コメント一覧の並び順・検索・続きの読み込み
10. `register-video.test.ts`：偽物の YouTube を使った、動画の登録とコメントの取得
11. `analyze.test.ts`：偽物の AI を使った、コメントの分析

## 6. 注意すること

- テストファイルは1つずつ順番に実行します（`vitest.config.mts` の `fileParallelism: false`）。削除ジョブのテストが DB 全体の期限切れ動画を消すため、同時に動かすと他のテストのデータを消してしまうからです。
- 動画を `insertVideo()` で作ると、分析の状況は「分析中（analyzing）」になります。分析中の動画では、分析されていないコメントは一覧に出ません。分析結果なしでコメント一覧を確かめたいときは、`analysisStatus: "failed"` を付けて作ります。
