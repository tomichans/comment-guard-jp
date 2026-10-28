import "server-only";

import { GROUP_BATCH_SIZE } from "@/lib/config/analysis";
import type { AdminClient } from "@/server/supabase/admin";
import type { UsageContext } from "@/server/usage";

import type { AnalysisAi } from "./ai";
import { assignGroups, fromVector, groupTypeOf, toVector } from "./grouping";

// =============================================================
// 類似したコメントのグルーピング（要件定義書10章）
//
// 流れ（1動画分。分類の1まわりが終わるたびに、analyze.ts から呼ばれる）
//   1. 分類が済み、グループの対象なのに、まだグループに入っていないコメントを読む（comments_to_group）
//   2. その論点（topic。分類の AI が分類と一緒に出したもの）の Embedding を、まとめて作る
//   3. 既存のグループと比べて、振り分ける（assignGroups）。似たグループがなければ、新しいグループにする
//   4. グループを保存し、コメントの分析結果に embedding と group_id を書き込む
//      新しいグループの見出し（representative_text）は、最初の1件の論点をそのまま使う
//   5. グループの件数（comment_count）を数え直す【確定】（+1 ではなく、そのつど数え直す）
//
// 本文ではなく論点で比べる理由【確定】（要件定義書10.3）：本文には動画の主題（料理名など）がどのコメントにも出てくるので、
// 本文どうしを比べると、論点が違っても主題だけで似て見えてしまうため。
//
// 分類の結果は先に保存しておき、Embedding とグループは後から書き込む【確定】。
// 分類が済んだコメントを先に画面に出すためと、Embedding で失敗しても分類の結果を失わないため。
// Embedding が NULL のまま残ったコメントは、次の機会（「分析をやり直す」など）に、同じ条件で拾われる。
//
// 同時に1つの動画を扱う処理は1つだけ（analyze.ts）なので、この関数の中は順番に進める。
// 並べて進めると、似たコメントが同時に別々の新しいグループを作ってしまうため。
// =============================================================

export async function groupPendingComments(
  admin: AdminClient,
  videoId: string,
  ai: AnalysisAi,
  ctx: UsageContext,
): Promise<void> {
  for (;;) {
    const { data: pending, error } = await admin.rpc("comments_to_group", {
      p_video_id: videoId,
      p_limit: GROUP_BATCH_SIZE,
    });
    if (error) throw error;
    if (pending.length === 0) return;

    const embeddings = await ai.embed(pending.map(topicOf), ctx);

    const { data: groups, error: groupsError } = await admin
      .from("comment_groups")
      .select("id, group_type, representative_embedding")
      .eq("video_id", videoId)
      .order("created_at")
      .order("id");
    if (groupsError) throw groupsError;

    const candidates = pending.map((p, i) => ({
      // comments_to_group が対象だけを返すので、null にはならない。
      groupType: groupTypeOf(p)!,
      embedding: embeddings[i],
    }));
    const { assignments, newGroups } = assignGroups(
      candidates,
      groups.map((g) => ({
        id: g.id,
        groupType: g.group_type,
        embedding: fromVector(g.representative_embedding),
      })),
    );

    // id をここで決めておくと、保存した行と newGroups の対応を、DB の返す順番に頼らずに付けられる。
    const newIds = newGroups.map(() => crypto.randomUUID());
    if (newGroups.length > 0) {
      const { error: insertError } = await admin.from("comment_groups").insert(
        newGroups.map((g, i) => ({
          id: newIds[i],
          video_id: videoId,
          group_type: g.groupType,
          representative_text: topicOf(pending[g.seed]),
          representative_embedding: toVector(embeddings[g.seed]),
          // 件数は、下の refresh_group_counts で数え直す。
          comment_count: 0,
        })),
      );
      if (insertError) throw insertError;
    }

    const results = await Promise.all(
      pending.map((p, i) => {
        const target = assignments[i];
        return admin
          .from("comment_analysis")
          .update({
            embedding: toVector(embeddings[i]),
            group_id: "groupId" in target ? target.groupId : newIds[target.newGroup],
          })
          .eq("id", p.analysis_id);
      }),
    );
    const updateError = results.find((r) => r.error)?.error;
    if (updateError) throw updateError;

    const { error: countError } = await admin.rpc("refresh_group_counts", { p_video_id: videoId });
    if (countError) throw countError;
  }
}

/** 比べる文：論点。AI が論点を出さなかったとき（ふつうは起きない）は、本文を短くしたもので代わりにする。 */
function topicOf(comment: { topic: string | null; comment_text: string }): string {
  return comment.topic || comment.comment_text.slice(0, 40);
}
