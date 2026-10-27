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
//   2. その本文の Embedding を、まとめて作る
//   3. 既存のグループと比べて、振り分ける（assignGroups）。似たグループがなければ、新しいグループにする
//   4. 新しいグループの代表論点を、AI でまとめて作る
//   5. グループを保存し、コメントの分析結果に embedding と group_id を書き込む
//   6. グループの件数（comment_count）を数え直す【確定】（+1 ではなく、そのつど数え直す）
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

    const embeddings = await ai.embed(
      pending.map((p) => p.comment_text),
      ctx,
    );

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

    // 新しいグループの代表論点を、1回の呼び出しでまとめて作る。
    const names =
      newGroups.length === 0
        ? []
        : await ai.nameGroups(
            newGroups.map((g) => ({ text: pending[g.seed].comment_text, groupType: g.groupType })),
            ctx,
          );
    // id をここで決めておくと、保存した行と newGroups の対応を、DB の返す順番に頼らずに付けられる。
    const newIds = newGroups.map(() => crypto.randomUUID());
    if (newGroups.length > 0) {
      const { error: insertError } = await admin.from("comment_groups").insert(
        newGroups.map((g, i) => ({
          id: newIds[i],
          video_id: videoId,
          group_type: g.groupType,
          representative_text: names[i],
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
