import { GROUP_SIMILARITY_THRESHOLD } from "@/lib/config/analysis";
import type { Enums } from "@/lib/database.types";

// =============================================================
// グルーピングの判定（要件定義書10章）
//
// DB や AI を使わない「値を入れて、値が出てくる」関数だけを置く（テストしやすくするため）。
// DB と AI を使う流れは group-comments.ts にある。
// =============================================================

export type GroupType = Enums<"group_type">;

export type CommentTopic = { groupType: GroupType; topic: string };

/**
 * コメントを、どちらのランキングに数えるか【確定】（要件定義書10.1）。
 * 分類の AI が出した論点（質問の論点と、指摘・要望の論点）ごとに、1つずつ返す（0〜2個）。
 *   - 返信は対象外【確定】（親コメントだけをグルーピングする）
 *   - スパムは対象外
 *   - 要注意（harmful）のコメントも対象【確定】。言い方がきつくても、中身の質問や指摘はランキングの目安に入れる
 *   - 論点がない（AI が出さなかった、または NGワードで AI を通さずに harmful にした）ときは、数えない
 */
export function topicsOf(comment: {
  isReply: boolean;
  primaryCategory: Enums<"primary_category">;
  questionTopic: string | null;
  feedbackTopic: string | null;
}): CommentTopic[] {
  if (comment.isReply || comment.primaryCategory === "spam") return [];
  const topics: CommentTopic[] = [];
  if (comment.questionTopic) topics.push({ groupType: "question", topic: comment.questionTopic });
  if (comment.feedbackTopic) topics.push({ groupType: "feedback_request", topic: comment.feedbackTopic });
  return topics;
}

/** コサイン類似度（-1〜1。1に近いほど、意味が似ている）。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type ExistingGroup = { id: string; groupType: GroupType; embedding: number[] };
export type GroupCandidate = { groupType: GroupType; embedding: number[] };

/** 1件のコメントの行き先：既存のグループ（groupId）か、新しく作るグループ（newGroups の何番目か）。 */
export type GroupAssignment = { groupId: string } | { newGroup: number };

/**
 * 論点（candidates）を、順番に1件ずつグループに振り分ける（要件定義書10.3）。
 *   - 同じ group_type のグループのうち、いちばん似ているものの類似度が threshold 以上なら、そこに合流する
 *   - なければ、そのコメントを最初の1件として、新しいグループを作る
 * 新しく作ったグループも、後ろのコメントの合流先になる（同じ回の中で、似たコメントが別々のグループにならないように）。
 * グループの基準（embedding）は、作ったときのコメントのもののまま変えない【確定】（10.3）。
 *
 * 返り値
 *   assignments … candidates と同じ順番の、行き先
 *   newGroups   … 新しく作るグループ。seed は、最初の1件になったコメントの番号（candidates の何番目か）
 */
export function assignGroups(
  candidates: GroupCandidate[],
  existing: ExistingGroup[],
  threshold: number = GROUP_SIMILARITY_THRESHOLD,
): {
  assignments: GroupAssignment[];
  newGroups: { groupType: GroupType; seed: number }[];
} {
  const groups: { target: GroupAssignment; groupType: GroupType; embedding: number[] }[] =
    existing.map((g) => ({ target: { groupId: g.id }, groupType: g.groupType, embedding: g.embedding }));
  const newGroups: { groupType: GroupType; seed: number }[] = [];

  const assignments = candidates.map((candidate, index) => {
    let best: (typeof groups)[number] | null = null;
    let bestSimilarity = -Infinity;
    for (const group of groups) {
      if (group.groupType !== candidate.groupType) continue;
      const similarity = cosineSimilarity(candidate.embedding, group.embedding);
      // 同じ類似度なら、先にあったグループを選ぶ（結果を毎回同じにするため）。
      if (similarity > bestSimilarity) {
        best = group;
        bestSimilarity = similarity;
      }
    }
    if (best && bestSimilarity >= threshold) return best.target;

    const target: GroupAssignment = { newGroup: newGroups.length };
    newGroups.push({ groupType: candidate.groupType, seed: index });
    groups.push({ target, groupType: candidate.groupType, embedding: candidate.embedding });
    return target;
  });

  return { assignments, newGroups };
}

/** pgvector の文字列表現（"[0.1,0.2,...]"）と、数の配列の変換。 */
export function toVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export function fromVector(vector: string): number[] {
  return JSON.parse(vector) as number[];
}
