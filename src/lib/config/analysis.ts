// =============================================================
// コメント分析の設定（要件定義書8章、9章、14章）
//
// 値はコードに直接書かず、ここで管理する（limits.ts、retention.ts と同じ考え方）。
// =============================================================

/**
 * 分類に使う AI のモデル（OpenAI）【確定】。環境変数 OPENAI_CLASSIFY_MODEL で切り替えられる（要件定義書14.2）。
 * 既定は、2026年10月時点の OpenAI で最も安い小型モデル。
 */
export const DEFAULT_CLASSIFY_MODEL = "gpt-6-luna";

/**
 * 分類の考える深さ（OpenAI の reasoningEffort）。
 * コメントの分類は単純な作業なので、"none"（考える工程なし）にして、速さと費用を優先する。
 * モデルを変えたときに、そのモデルが "none" に対応していなければ、ここも変える。
 */
export const CLASSIFY_REASONING_EFFORT = "none";

/** NG判定に使う OpenAI Moderation API のモデル（無料）【確定】（要件定義書9.2） */
export const MODERATION_MODEL = "omni-moderation-latest";

/** AI に1回でまとめて送るコメントの数（要件定義書14.1：50〜100件が目安） */
export const CLASSIFY_BATCH_SIZE = 50;

/**
 * 同時に AI へ送るまとまり（バッチ）の数。
 * 1000スレッド（返信を含めると1000件以上）でも、時間内（数分）に終わるよう、いくつか並べて送る。
 */
export const CLASSIFY_CONCURRENCY = 4;

/** AI の1回の呼び出しで待つ時間（ミリ秒）。これを超えたら時間切れとして、やり直す。 */
export const AI_TIMEOUT_MS = 60_000;

/** AI の呼び出しが失敗（時間切れ・一時的な障害）したときに、やり直す回数（要件定義書14.2：最大2回） */
export const AI_MAX_RETRIES = 2;

/** これより確信度（score）が低い harmful は、人の確認が必要（review_required）にする（要件定義書9.2） */
export const REVIEW_SCORE_THRESHOLD = 0.7;

/**
 * 「分析中」のまま、これだけの時間（ミリ秒）何も進まなければ、止まったものとみなして「失敗」と同じ扱いにする。
 * サーバーの処理が時間切れなどで途中で止まると、analysis_status が analyzing のまま残るため。
 * 進んだかどうかは、その動画の API 呼び出しの記録（api_usage_logs）の最新の時刻で判断する。
 * AI の1回の呼び出しは、やり直しを含めて最大3分（60秒×3回）なので、それより長くする。
 */
export const ANALYSIS_STALLED_MS = 5 * 60 * 1000;

/**
 * AI の料金（米ドル、100万トークンあたり）。api_usage_logs の推定費用（estimated_cost_usd）の計算に使う。
 * 2026年10月時点の OpenAI の料金ページの値。料金が変わったら、ここを直す。
 * 表にないモデルを使った場合、推定費用は NULL になる（トークン数は記録される）。
 */
export const AI_PRICES_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  // Embedding は出力のトークンがないので、output は 0。
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

// -------------------------------------------------------------
// グルーピングとランキング（要件定義書10章、11章。スライス4）
// -------------------------------------------------------------

/** グルーピングに使う Embedding のモデル【確定】（要件定義書10.2）。次元数は 1536（DB の vector(1536)）。 */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** これ以上似ていれば、既存のグループに合流させる（コサイン類似度）【確定】（要件定義書10.2） */
export const GROUP_SIMILARITY_THRESHOLD = 0.82;

/** グルーピングで、1回にまとめて扱うコメントの数（Embedding の1回の呼び出しで送る数） */
export const GROUP_BATCH_SIZE = 100;

/** ランキングに表示する数【確定】：どちらのランキングも1〜3位まで（要件定義書11章） */
export const RANKING_SIZE = 3;
