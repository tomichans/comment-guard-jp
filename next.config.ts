import type { NextConfig } from "next";

// =============================================================
// セキュリティ用のレスポンスヘッダー（要件定義書16章）【確定】
//
// ブラウザに「このページをどう扱ってよいか」を伝えて、ブラウザ側でも攻撃を防いでもらう。
// どれもアプリの動きは変えない（画面の表示や API の結果はそのまま）。
//
// - Content-Security-Policy（一部だけ）
//     frame-ancestors 'none'：他のサイトに枠（iframe）で埋め込ませない。
//       透明な枠で重ねて、ユーザーに「削除」などを誤ってクリックさせる攻撃（クリックジャッキング）を防ぐ。
//     object-src 'none'：古いプラグイン（Flash など）の読み込みを禁止する。
//     base-uri 'self'、form-action 'self'：ページの基準URLとフォームの送信先を、自分のサイトに限る。
//   スクリプトの読み込み元まで制限する完全な CSP は、Next.js では nonce（毎回変わる合言葉）の仕組みが必要になり、
//   設定が大きくなるため入れていない。コメント本文は React が文字として表示する（HTML として描画しない）ので、
//   埋め込みスクリプトの対策は、そちらで行っている。
// - X-Frame-Options: DENY：frame-ancestors と同じ意味の古い書き方（古いブラウザ向け）。
// - X-Content-Type-Options: nosniff：ファイルの種類をブラウザに推測させない（画像のふりをしたスクリプトを実行させない）。
// - Referrer-Policy：他のサイトへ移動するとき、URL のうちドメインだけを伝える（/videos/:id のような URL を渡さない）。
// - Permissions-Policy：使わない機能（カメラ、マイク、位置情報）を、ページから使えないようにする。
// - Strict-Transport-Security：一度 HTTPS で開いたら、以後は必ず HTTPS で接続させる（通信の盗み見を防ぐ）。
//   http://localhost ではブラウザが無視するので、開発には影響しない。
// =============================================================

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // 「X-Powered-By: Next.js」を返さない。使っている技術を攻撃者に教えないため。
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
