import { VideoView } from "@/components/app/video-view";

// 動画ごとのページ（/videos/:id）：中央は ②分析結果（コメント一覧）（要件定義書4.3）
// URL を動画ごとに分けているので、再読み込みや「戻る」でも同じ動画を開ける。
export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // key：別の動画に移ったときに、前の動画の表示（コメントなど）を残さず、作り直す。
  return <VideoView key={id} videoId={id} />;
}
