import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  COMMENT_PAGE_SIZE,
  DEFAULT_COMMENT_SORT,
  type CommentSort,
} from "@/lib/comment-list";
import {
  COMMENT_TABS,
  type AnalysisSummary,
  type CommentTab,
  type PrimaryCategory,
} from "@/lib/comment-categories";
import { RANKING_SIZE } from "@/lib/config/analysis";
import { expiryCutoff, isExpired } from "@/lib/config/retention";
import type { Database, Tables } from "@/lib/database.types";
import {
  DEFAULT_GROUP_COMMENT_TAB,
  type GroupCommentTab,
  type RankingItem,
  type VideoRankings,
} from "@/lib/rankings";
import { isUuid } from "@/lib/uuid";
import { effectiveAnalysisStatus } from "@/server/analysis/status";
import { createAdminClient } from "@/server/supabase/admin";

// =============================================================
// アクセス制御の共通関数（このファイルだけが「誰のデータを見せるか」を決める）
//
// API Route は、動画やその子データ（コメントなど）を読むとき、必ずこのファイルの関数を通す。
// 所有確認を各 API Route に書くと、1か所でも書き忘れれば他人のデータが漏れる。
// 1か所にまとめておけば、確認すべき場所もテストすべき場所も、ここだけになる。
//
// 判定する内容
//   1. 所有者が一致するか（ログインユーザーなら user_id、ゲストなら guest_id）
//   2. 保持期間内か（要件定義書3.3。削除ジョブが動く前でも、期限切れは見せない）
// どちらかを満たさなければ、「存在しない」と同じ扱い（null）にする。
// 「他人の動画です」と区別して返すと、その ID の動画が存在することを相手に教えてしまうため。
// =============================================================

export type Video = Tables<"videos">;
export type Comment = Tables<"comments">;

/**
 * リクエストの持ち主。src/server/owner.ts の getRequestOwner() で作る。
 *
 * ログインユーザーは、そのユーザーとしてログインした Supabase クライアントを持つ。
 * このクライアントは RLS が効くので、ここでの絞り込みを書き忘れても DB が他人の行を返さない（二重の防御）。
 * ゲストには RLS のポリシーがないため、service role クライアントで読み、guest_id の絞り込みが唯一の防御になる。
 */
export type Owner =
  | { kind: "user"; userId: string; client: SupabaseClient<Database> }
  | { kind: "guest"; guestId: string };

function clientFor(owner: Owner): SupabaseClient<Database> {
  return owner.kind === "user" ? owner.client : createAdminClient();
}

/** 自分の動画を1件取得する。他人の動画・期限切れ・存在しない場合は null。 */
export async function findOwnedVideo(
  owner: Owner,
  videoId: string,
  now: Date = new Date(),
): Promise<Video | null> {
  if (!isUuid(videoId)) return null;

  let query = clientFor(owner).from("videos").select("*").eq("id", videoId);
  query =
    owner.kind === "user"
      ? query.eq("user_id", owner.userId)
      : query.eq("guest_id", owner.guestId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || isExpired(data, now)) return null;
  return data;
}

/** 自分の動画の一覧（期限内のものだけ、新しい順）。 */
export async function listOwnedVideos(
  owner: Owner,
  now: Date = new Date(),
): Promise<Video[]> {
  let query = clientFor(owner).from("videos").select("*");
  query =
    owner.kind === "user"
      ? query.eq("user_id", owner.userId)
      : query.eq("guest_id", owner.guestId);

  // 期限切れの判定は isExpired() と同じ境界（expiryCutoff）を DB 側の条件にしたもの。
  const cutoff = expiryCutoff(owner.kind, now).toISOString();
  const { data, error } = await query
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** コメントの分析結果のうち、画面で使うもの。まだ分析されていないコメントは null。 */
export type CommentAnalysis = Pick<
  Tables<"comment_analysis">,
  "primary_category" | "labels" | "review_required"
>;

export type CommentWithAnalysis = Comment & { analysis: CommentAnalysis | null };

export type CommentThread = CommentWithAnalysis & {
  /** 保存されている返信（古い順）。YouTube が同梱した数件だけ（要件定義書7.3）。 */
  replies: CommentWithAnalysis[];
};

/** ランキングで選んだグループ（コメント一覧の絞り込みに使う）。 */
export type SelectedGroup = Pick<Tables<"comment_groups">, "id" | "group_type" | "representative_text">;

export type CommentThreadPage = {
  threads: CommentThread[];
  /**
   * group で絞り込んだときの、そのグループ（見出しの表示用）。
   * 絞り込んでいないときと、グループが見つからない（この動画のものではない）ときは null。
   */
  group: SelectedGroup | null;
  /** group で絞り込んだときの、タブ（おだやか・要注意）ごとのスレッドの数。絞り込んでいないときは null。 */
  groupCounts: Record<GroupCommentTab, number> | null;
  /** 条件（タブ・検索語）に合うスレッドの総数 */
  total: number;
  /** 続きを読み込むときの offset。最後まで読み込んだら null。 */
  nextOffset: number | null;
};

export type CommentListOptions = {
  sort?: CommentSort;
  /** 親コメントの分類（タブ）。"all" は絞り込まない（other もここにだけ出る）。 */
  tab?: CommentTab;
  /** 親コメントの本文に含まれる語（部分一致）。空なら絞り込まない。 */
  q?: string;
  /**
   * ランキングのグループ（comment_groups.id）。指定すると、そのグループに論点が入っているコメントだけにする。
   * グループには分類の違うコメント（質問、指摘・要望、要注意など）が入るので、指定したときは tab を使わず、groupTab を使う。
   */
  group?: string;
  /** group を指定したときのタブ：おだやか（calm。harmful 以外）か、要注意（harmful） */
  groupTab?: GroupCommentTab;
  offset?: number;
};

// 並び順ごとの、DB の並べ替えの列（上から順に比べる）。
// 値のない行（NULL）は最後に回す。最後に id で並べるのは、同じ値の行の順番を毎回同じにして、
// 続きを読み込んだときに、同じコメントが2回出たり抜けたりしないようにするため。
const SORT_COLUMNS = {
  newest: ["posted_at"],
  likes: ["like_count", "posted_at"],
  replies: ["reply_count", "posted_at"],
} as const satisfies Record<CommentSort, readonly (keyof Comment)[]>;

// [Supabase固有] comments に、最新の分析結果（comment_analysis）を一緒に付けて読む（PostgREST の埋め込み）。
// 「!inner」を付けると、分析結果のあるコメントだけになる（SQL の INNER JOIN）。付けなければ LEFT JOIN。
const WITH_ANALYSIS = "*, comment_analysis(primary_category, labels, review_required)";
const ONLY_ANALYZED = "*, comment_analysis!inner(primary_category, labels, review_required)";
// ランキングのグループで絞り込むとき：分析結果の下の論点（comment_topics）まで INNER JOIN でつなぎ、
// 論点の group_id で絞り込む（「comment_analysis.comment_topics.group_id」のように、つないだ先の列で絞れる）。
const IN_GROUP =
  "*, comment_analysis!inner(primary_category, labels, review_required, comment_topics!inner(group_id))";

/**
 * 自分の動画のコメント一覧を、スレッド（親コメント＋返信）の形で、COMMENT_PAGE_SIZE 件ずつ返す。
 * 動画が自分のものでなければ null。
 *
 * comments は所有者の列を持たない（所有者は videos だけが持つ。要件定義書13.2）。
 * そのため、必ず先に findOwnedVideo() で動画の所有を確認してから、その動画の id でコメントを読む。
 * 子テーブル（comment_analysis、comment_groups、advice_logs）を読む関数も、同じ形にする（getRankingsOfOwnedVideo など）。
 *
 * 並べ替え・検索・タブの絞り込み・件数の区切りは、親コメントに対して行う。返信は、そのページの親コメントの分だけ読む。
 *
 * まだ分析されていないコメントは見せない【確定】。分類される前に、攻撃的なコメントが目に入るのを防ぐため。
 * ただし分析に失敗したときは、「すべて」タブで、分析されていないコメントも見せる（要件定義書15.2：AI の障害時でも一覧は見られる）。
 */
export async function listCommentThreadsOfOwnedVideo(
  owner: Owner,
  videoId: string,
  {
    sort = DEFAULT_COMMENT_SORT,
    tab = "all",
    q = "",
    group,
    groupTab = DEFAULT_GROUP_COMMENT_TAB,
    offset = 0,
  }: CommentListOptions = {},
  now: Date = new Date(),
): Promise<CommentThreadPage | null> {
  const video = await findOwnedVideo(owner, videoId, now);
  if (!video) return null;
  const client = clientFor(owner);

  // ランキングのグループで絞り込むとき：グループも、この動画のものに限って読む（他の動画のグループの id を渡されても、見つからない扱い）。
  let selectedGroup: SelectedGroup | null = null;
  if (group !== undefined) {
    selectedGroup = isUuid(group) ? await findGroup(client, video.id, group) : null;
    if (!selectedGroup) {
      return { threads: [], group: null, groupCounts: null, total: 0, nextOffset: null };
    }
  }

  const analysisFailed = (await effectiveAnalysisStatus(video, now)) === "failed";
  // グループのコメントは、分析が済んだものだけ（グループは分析の結果から作るので）。
  const includeUnanalyzed = analysisFailed && tab === "all" && !selectedGroup;

  // [Supabase固有] count: "exact" で、条件に合う行の総数も一緒に受け取る（「全123件」の表示用）。
  let query = client
    .from("comments")
    .select(selectedGroup ? IN_GROUP : includeUnanalyzed ? WITH_ANALYSIS : ONLY_ANALYZED, {
      count: "exact",
    })
    .eq("video_id", video.id)
    .is("parent_comment_id", null)
    .eq("comment_analysis.is_latest", true);
  if (selectedGroup) {
    query = query.eq("comment_analysis.comment_topics.group_id", selectedGroup.id);
    query =
      groupTab === "harmful"
        ? query.eq("comment_analysis.primary_category", "harmful")
        : query.neq("comment_analysis.primary_category", "harmful");
  } else if (tab !== "all") {
    query = query.eq("comment_analysis.primary_category", tab);
  }
  // 検索するのは親コメントの本文だけ（返信は含めない。要件定義書4.3）。
  if (q) query = query.ilike("comment_text", `%${escapeLike(q)}%`);
  for (const column of SORT_COLUMNS[sort]) {
    query = query.order(column, { ascending: false, nullsFirst: false });
  }
  const { data: parents, error, count } = await query
    .order("id")
    .range(offset, offset + COMMENT_PAGE_SIZE - 1);
  if (error) throw error;

  const repliesByParent = new Map<string, CommentWithAnalysis[]>();
  if (parents.length > 0) {
    // 返信は、親のタブに関係なく、保存されているものを付ける。
    // まだ分析されていない返信は、分析に失敗したときだけ見せる。
    const { data: replies, error: repliesError } = await client
      .from("comments")
      .select(analysisFailed ? WITH_ANALYSIS : ONLY_ANALYZED)
      .eq("video_id", video.id)
      .in(
        "parent_comment_id",
        parents.map((p) => p.id),
      )
      .eq("comment_analysis.is_latest", true)
      .order("posted_at", { ascending: true, nullsFirst: false })
      .order("id");
    if (repliesError) throw repliesError;
    for (const reply of replies) {
      const list = repliesByParent.get(reply.parent_comment_id!) ?? [];
      list.push(withAnalysis(reply));
      repliesByParent.set(reply.parent_comment_id!, list);
    }
  }

  const total = count ?? 0;
  const next = offset + parents.length;
  return {
    threads: parents.map((p) => ({ ...withAnalysis(p), replies: repliesByParent.get(p.id) ?? [] })),
    group: selectedGroup,
    groupCounts: selectedGroup ? await countGroupThreads(client, video.id, selectedGroup.id) : null,
    total,
    nextOffset: parents.length > 0 && next < total ? next : null,
  };
}

/** グループに論点が入っている親コメントの数を、タブ（おだやか・要注意）ごとに数える（検索語には関係なく）。 */
async function countGroupThreads(
  client: SupabaseClient<Database>,
  videoId: string,
  groupId: string,
): Promise<Record<GroupCommentTab, number>> {
  const count = async (harmful: boolean) => {
    const query = client
      .from("comments")
      .select(IN_GROUP, { count: "exact", head: true })
      .eq("video_id", videoId)
      .is("parent_comment_id", null)
      .eq("comment_analysis.is_latest", true)
      .eq("comment_analysis.comment_topics.group_id", groupId);
    const { count, error } = harmful
      ? await query.eq("comment_analysis.primary_category", "harmful")
      : await query.neq("comment_analysis.primary_category", "harmful");
    if (error) throw error;
    return count ?? 0;
  };
  const [calm, harmful] = await Promise.all([count(false), count(true)]);
  return { calm, harmful };
}

/** 動画のグループを1件読む。この動画のグループでなければ null。 */
async function findGroup(
  client: SupabaseClient<Database>,
  videoId: string,
  groupId: string,
): Promise<SelectedGroup | null> {
  const { data, error } = await client
    .from("comment_groups")
    .select("id, group_type, representative_text")
    .eq("video_id", videoId)
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * 埋め込みで受け取った comment_analysis（配列。最新の1件だけ）を、analysis（1件か null）に直す。
 * 画面で使う列だけを残す（グループで絞り込んだときに付いてくる comment_topics は渡さない）。
 */
function withAnalysis({
  comment_analysis,
  ...comment
}: Comment & { comment_analysis: CommentAnalysis[] }): CommentWithAnalysis {
  const analysis = comment_analysis[0];
  return {
    ...comment,
    analysis: analysis
      ? {
          primary_category: analysis.primary_category,
          labels: analysis.labels,
          review_required: analysis.review_required,
        }
      : null,
  };
}

/** 自分の動画の、分析の進み具合とタブごとの件数。動画が自分のものでなければ null。 */
export async function getAnalysisSummaryOfOwnedVideo(
  owner: Owner,
  videoId: string,
  now: Date = new Date(),
): Promise<AnalysisSummary | null> {
  const video = await findOwnedVideo(owner, videoId, now);
  if (!video) return null;

  const [status, { data, error }] = await Promise.all([
    effectiveAnalysisStatus(video, now),
    clientFor(owner).rpc("video_analysis_summary", { p_video_id: video.id }),
  ]);
  if (error) throw error;
  const summary = data as {
    total: number;
    analyzed: number;
    counts: Partial<Record<PrimaryCategory, number>>;
  };

  const counts = Object.fromEntries(
    COMMENT_TABS.map(({ value }) => [
      value,
      value === "all"
        ? Object.values(summary.counts).reduce((sum, n) => sum + (n ?? 0), 0)
        : (summary.counts[value] ?? 0),
    ]),
  ) as Record<CommentTab, number>;
  // 分析に失敗したときは、「すべて」に分析されていない親コメントも出るので、その数も含める。
  if (status === "failed") counts.all = await countParents(owner, video.id);

  return { status, total: summary.total, analyzed: summary.analyzed, counts };
}

/**
 * 自分の動画の、指摘・要望ランキングと質問ランキング（上位3件ずつ。要件定義書11章）。動画が自分のものでなければ null。
 * 並び順は SQL の関数 video_rankings に書いてある。
 */
export async function getRankingsOfOwnedVideo(
  owner: Owner,
  videoId: string,
  now: Date = new Date(),
): Promise<VideoRankings | null> {
  const video = await findOwnedVideo(owner, videoId, now);
  if (!video) return null;

  const [status, { data, error }] = await Promise.all([
    effectiveAnalysisStatus(video, now),
    clientFor(owner).rpc("video_rankings", { p_video_id: video.id, p_limit: RANKING_SIZE }),
  ]);
  if (error) throw error;
  const rankings = data as { feedback_request: RankingItem[]; question: RankingItem[] };
  return { status, feedbackRequest: rankings.feedback_request, question: rankings.question };
}

async function countParents(owner: Owner, videoId: string): Promise<number> {
  const { count, error } = await clientFor(owner)
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("video_id", videoId)
    .is("parent_comment_id", null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * LIKE の検索語に含まれる記号（%、_、\）を、ただの文字として扱うようにする。
 * [Supabase固有] PostgREST は * も「何にでも一致」として扱い、これは打ち消せない。
 * 「*」で検索すると全件が出るだけで害はないため、そのままにしている。
 */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * 自分の動画を削除する（要件定義書18.2）。削除できたら true、他人の動画・期限切れ・存在しない場合は false。
 *
 * 削除できるのはログインユーザーだけなので、引数もログインユーザーに限っている（ゲストは API Route で 403 にする）。
 * 削除はログインユーザーの Supabase クライアントで行うので、RLS の videos_delete_own も効く（二重の防御）。
 * 消すのは videos の行だけ。コメント、分析結果、グループ、アドバイスは ON DELETE CASCADE で DB が連鎖して削除する（13.4）。
 */
export async function deleteOwnedVideo(
  owner: Extract<Owner, { kind: "user" }>,
  videoId: string,
  now: Date = new Date(),
): Promise<boolean> {
  // 期限切れの動画は「存在しない」扱い（3.3）なので、先に findOwnedVideo() で確認する。
  const video = await findOwnedVideo(owner, videoId, now);
  if (!video) return false;

  // count: "exact" で、実際に消えた行数を受け取る。
  // 確認と削除の間に削除ジョブなどで消えていた場合は 0 になり、「存在しない」として扱う。
  const { count, error } = await owner.client
    .from("videos")
    .delete({ count: "exact" })
    .eq("id", video.id)
    .eq("user_id", owner.userId);
  if (error) throw error;
  return count === 1;
}
