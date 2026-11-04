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
 * 分類の考える深さ（OpenAI の reasoningEffort）【確定】："low"（少しだけ考える）。
 * 当初は "none"（考える工程なし）だったが、豆知識や反語を質問に分類するなどの誤りがあったため、
 * 迷う文を考え直せるようにした。費用と時間は少し増える（要件定義書14.1）。
 * モデルを変えたときに、そのモデルが "low" に対応していなければ、ここも変える。
 */
export const CLASSIFY_REASONING_EFFORT = "low";

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

/**
 * これ以上似ていれば、既存のグループに合流させる（コサイン類似度）【確定】（要件定義書10.2）。
 * 比べるのは、コメント本文ではなく、分類の AI が出した論点（例：「塩加減の説明」）。
 * 経緯：本文どうしを比べていたときは、0.82 では言い換えも合流せず（言い換えで 0.556）、
 * 0.5 では動画の主題（料理名など）が共通なだけで別の論点が合流した。
 * 論点は主題を含まない短い名詞句なので、言い換えは近く、別の論点は遠くなる見込み。0.6 から様子を見る。
 */
export const GROUP_SIMILARITY_THRESHOLD = 0.6;

/** グルーピングで、1回にまとめて扱うコメントの数（Embedding の1回の呼び出しで送る数） */
export const GROUP_BATCH_SIZE = 100;

/** ランキングに表示する数【確定】：どちらのランキングも1〜3位まで（要件定義書11章） */
export const RANKING_SIZE = 3;

// -------------------------------------------------------------
// AIアドバイス（要件定義書12章。スライス5）
// -------------------------------------------------------------

/**
 * アドバイスに使う AI のモデル（OpenAI）【確定】。環境変数 OPENAI_ADVICE_MODEL で切り替えられる（要件定義書14.1）。
 * 1動画につき1回だけ、集計済みのデータ（件数・ランキング・一部のコメント）を渡すので、分類より高性能なモデルにした。
 * 物足りなければ、上位の gpt-6-astra に変える。
 */
export const DEFAULT_ADVICE_MODEL = "gpt-6.1-sol";

/** アドバイスの考える深さ（OpenAI の reasoningEffort）。分類と同じ "low"（時間切れにならないよう、長く考えさせない）。 */
export const ADVICE_REASONING_EFFORT = "low";

/**
 * 分析が済んだ親コメントがこれより少ない動画では、アドバイスを作らない【確定】（要件定義書12.3）。
 * コメントが少なすぎると、「多い声」が言えず、数件の意見を全体の声のように伝えてしまうため。
 */
export const ADVICE_MIN_ANALYZED_COMMENTS = 10;

/** アドバイスの AI に渡す、ランキングのグループの数（指摘・要望と質問、それぞれ）。画面のランキング（3位まで）より少し多く渡す。 */
export const ADVICE_TOP_GROUPS = 5;

/**
 * アドバイスの AI に渡す、コメント本文の例の数（ポジティブと否定的意見、それぞれ。いいねが多い順）【確定】（要件定義書12.2）。
 * 「何が評価されたか」「どんな否定的意見があったか」は件数だけでは分からないため、一部の本文を渡す。
 * 要注意（harmful）とスパムの本文は渡さない（アドバイスに暴言が入らないようにするため）。
 */
export const ADVICE_SAMPLE_COMMENTS = 10;

/** アドバイスの AI に渡すコメント本文の長さの上限（文字）。長いコメントで入力が増えすぎないようにする。 */
export const ADVICE_SAMPLE_MAX_LENGTH = 200;
