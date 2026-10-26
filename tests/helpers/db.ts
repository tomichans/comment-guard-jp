import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

// =============================================================
// テスト用のヘルパー
//
// テストはローカルの Supabase（npx supabase start）に対して実行する。
// テストデータは service role で直接 INSERT する。YouTube からの取得は、偽物の YouTubeApi で再現する（tests/helpers/fake-youtube.ts）。
// 各テストは自分が作ったデータだけを後片付けする。
// =============================================================

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** [Supabase固有] service role（RLS を無視する）クライアント。テストデータの準備と確認に使う。 */
export const admin = createClient<Database>(url, serviceRoleKey, noSession);

/** [Supabase固有] 未ログイン（anon キーのみ）のクライアント。ブラウザから直接叩かれた場合を再現する。 */
export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, noSession);
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export function ago(ms: number, now: Date = new Date()): string {
  return new Date(now.getTime() - ms).toISOString();
}

export type TestUser = {
  userId: string;
  /** そのユーザーとしてログインしたクライアント（RLS が効く） */
  client: SupabaseClient<Database>;
};

const createdUserIds: string[] = [];
const createdGuestIds: string[] = [];

/**
 * テスト用のログインユーザーを作り、そのユーザーとしてログインしたクライアントを返す。
 * [Supabase固有] auth.admin.createUser は service role でだけ使える管理用 API。
 * email_confirm: true で、メール確認済みの状態で作る。
 * public.users の行は、DBトリガー（on_auth_user_created）が自動で作る。
 */
export async function createTestUser(): Promise<TestUser> {
  const email = `test-${crypto.randomUUID()}@example.com`;
  const password = "test-password-123";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  return { userId: data.user.id, client };
}

export function newGuestId(): string {
  const id = crypto.randomUUID();
  createdGuestIds.push(id);
  return id;
}

let youtubeSourceId: string | undefined;

async function getYoutubeSourceId(): Promise<string> {
  if (youtubeSourceId) return youtubeSourceId;
  const { data, error } = await admin
    .from("sources")
    .select("id")
    .eq("name", "youtube")
    .single();
  if (error) throw error;
  youtubeSourceId = data.id;
  return data.id;
}

/**
 * 動画を1本作る。所有者は userId か guestId のどちらか一方。
 * analysisStatus を省くと、DB の既定値（analyzing）になる。
 */
export async function insertVideo(opts: {
  userId?: string;
  guestId?: string;
  createdAt?: string;
  analysisStatus?: "analyzing" | "done" | "failed";
}) {
  const { data, error } = await admin
    .from("videos")
    .insert({
      user_id: opts.userId ?? null,
      guest_id: opts.guestId ?? null,
      source_id: await getYoutubeSourceId(),
      video_id: `yt-${crypto.randomUUID().slice(0, 8)}`,
      title: "テスト動画",
      ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
      ...(opts.analysisStatus ? { analysis_status: opts.analysisStatus } : {}),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// text-embedding-3-small と同じ 1536 次元のダミーベクトル（pgvector の文字列表現）。
const DUMMY_EMBEDDING = `[${Array(1536).fill(0.01).join(",")}]`;

/**
 * 動画に、すべての子テーブルのデータを1行ずつ作る。
 * 連鎖削除と RLS のテストで、「子テーブルまで」確かめるため。
 */
export async function insertChildren(videoId: string) {
  const comment = await admin
    .from("comments")
    .insert({
      video_id: videoId,
      external_comment_id: `c-${crypto.randomUUID()}`,
      comment_text: "BGMが大きいです",
    })
    .select()
    .single();
  if (comment.error) throw comment.error;

  const group = await admin
    .from("comment_groups")
    .insert({
      video_id: videoId,
      group_type: "feedback_request",
      representative_text: "BGMが大きい",
      representative_embedding: DUMMY_EMBEDDING,
      comment_count: 1,
    })
    .select()
    .single();
  if (group.error) throw group.error;

  const analysis = await admin
    .from("comment_analysis")
    .insert({
      comment_id: comment.data.id,
      analyzed_at: new Date().toISOString(),
      primary_category: "feedback",
      labels: ["request"],
      group_id: group.data.id,
    })
    .select()
    .single();
  if (analysis.error) throw analysis.error;

  const advice = await admin
    .from("advice_logs")
    .insert({
      video_id: videoId,
      advice_text: "BGMの音量を下げましょう",
      advice_summary: "BGMを下げる",
      triggered_by: "system",
      generated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (advice.error) throw advice.error;

  return {
    commentId: comment.data.id,
    groupId: group.data.id,
    analysisId: analysis.data.id,
    adviceId: advice.data.id,
  };
}

/** 指定したテーブルに、その id の行が残っているか。 */
export async function exists(
  table: "videos" | "comments" | "comment_groups" | "comment_analysis" | "advice_logs",
  id: string,
): Promise<boolean> {
  const { data, error } = await admin.from(table).select("id").eq("id", id);
  if (error) throw error;
  return data.length > 0;
}

/**
 * テストで作ったデータを消す。
 * ユーザーは Auth から消せば、public.users → videos → 子テーブルまで CASCADE で消える。
 * ゲストの動画は videos を消せば子テーブルまで消える。
 */
export async function cleanup() {
  // API使用量の記録は、動画やユーザーを消しても残る設計なので、テストで作った分を個別に消す。
  if (createdUserIds.length > 0) {
    await admin.from("api_usage_logs").delete().in("user_id", createdUserIds);
  }
  if (createdGuestIds.length > 0) {
    await admin.from("api_usage_logs").delete().in("guest_id", createdGuestIds);
  }
  for (const id of createdUserIds.splice(0)) {
    await admin.auth.admin.deleteUser(id);
  }
  const guestIds = createdGuestIds.splice(0);
  if (guestIds.length > 0) {
    await admin.from("videos").delete().in("guest_id", guestIds);
  }
}
