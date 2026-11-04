import type { Metadata } from "next";

import {
  ExternalLink,
  LegalDocument,
  LegalList,
  LegalSection,
} from "@/components/legal/legal-document";
import {
  GUEST_RETENTION_HOURS,
  USAGE_LOG_RETENTION_DAYS,
  USER_RETENTION_DAYS,
} from "@/lib/config/retention";
import { CONTACT_EMAIL, DELETION_REQUEST_DAYS, OPERATOR_NAME } from "@/lib/config/site";

export const metadata: Metadata = { title: "プライバシーポリシー | CommentGuard JP" };

// プライバシーポリシー（要件定義書18.3）。数値（保持期間など）は定数から表示し、コードと文章がずれないようにする。
export default function PrivacyPage() {
  const mail = (
    <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4">
      {CONTACT_EMAIL}
    </a>
  );

  return (
    <LegalDocument title="プライバシーポリシー">
      <p>
        {OPERATOR_NAME}（以下「運営者」）は、CommentGuard JP（以下「本サービス」）で扱う情報を、
        このプライバシーポリシーに従って取り扱います。
      </p>

      <LegalSection title="1. 運営者と連絡先">
        <p>
          運営者：{OPERATOR_NAME}
          <br />
          連絡先：{mail}
        </p>
      </LegalSection>

      <LegalSection title="2. 取得する情報">
        <LegalList>
          <li>
            <strong>アカウントの情報</strong>：メールアドレスとパスワード（ログインユーザーのみ）。パスワードは、
            認証サービス（Supabase Auth）が元に戻せない形に変換して保存し、運営者も読めません。
          </li>
          <li>
            <strong>YouTube から取得する情報</strong>：入力された動画の情報（タイトル、サムネイル画像のURL、公開日時）と、
            その動画の公開コメント（本文、投稿者の表示名、いいねの数、返信の数、投稿日時）。YouTube API Services を使って取得します。
          </li>
          <li>
            <strong>分析の結果</strong>：コメントの分類、論点、ランキング、AI のアドバイス。
          </li>
          <li>
            <strong>ゲストの識別子</strong>：ログインせずに使う方のブラウザを区別するための、ランダムな ID（Cookie に保存）。
          </li>
          <li>
            <strong>利用の記録</strong>：外部の API（YouTube、OpenAI）を呼び出した日時、回数、使用量。
            ゲストの利用上限の判定のため、通信元の IP アドレスを、元に戻せない形（HMAC-SHA256）に変換した値も記録します。
            IP アドレスそのものは保存しません。
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="3. 利用の目的">
        <LegalList>
          <li>コメントの分類、集計、AI のアドバイスの作成など、本サービスの機能を提供するため</li>
          <li>ログインと、ゲストのデータの区別のため</li>
          <li>利用上限の判定と、費用や不正な利用の監視のため</li>
          <li>お問い合わせや削除の依頼に対応するため</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="4. 外部のサービスへの送信">
        <p>本サービスは、次の外部のサービスを利用しており、機能に必要な範囲で情報を送信・保存します。</p>
        <LegalList>
          <li>
            <strong>Google（YouTube Data API）</strong>：動画とコメントの取得。Google のプライバシーポリシー（
            <ExternalLink href="https://policies.google.com/privacy" />）が適用されます。
          </li>
          <li>
            <strong>OpenAI</strong>：コメントの分類、攻撃的な表現の判定、類似したコメントのまとめ、AI のアドバイスの作成。
            送るのは、コメントの本文、動画のタイトル、集計した件数などで、投稿者の名前は送りません。
          </li>
          <li>
            <strong>Supabase</strong>：データベースと、ログインの仕組み（上記2の情報を保存します）。
          </li>
          <li>
            <strong>Vercel</strong>：本サービスの配信（Web サーバー）。
          </li>
        </LegalList>
        <p>法令に基づく場合を除き、上記以外の第三者に情報を提供することはありません。広告や行動分析のためのツールは使っていません。</p>
      </LegalSection>

      <LegalSection title="5. Cookie">
        <LegalList>
          <li>
            ゲストの識別子を、Cookie（有効期限{GUEST_RETENTION_HOURS}時間）に保存します。JavaScript からは読めない設定（httpOnly）です。
          </li>
          <li>ログインユーザーのログイン状態を、Cookie に保存します。</li>
          <li>広告や行動分析のための Cookie は使いません。</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="6. 保存する期間">
        <LegalList>
          <li>
            YouTube から取得した情報と分析の結果：ゲストは{GUEST_RETENTION_HOURS}時間、ログインユーザーは最長
            {USER_RETENTION_DAYS}日で自動的に削除します（YouTube API Services の規約に従うため）。
          </li>
          <li>サムネイル画像は保存せず、YouTube 上の画像の URL を参照して表示します。</li>
          <li>利用の記録：{USAGE_LOG_RETENTION_DAYS}日で自動的に削除します。</li>
          <li>アカウントの情報：アカウントを削除するまで保存します。</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="7. 削除の方法">
        <LegalList>
          <li>ログインユーザーは、画面の動画一覧から、保存した動画をいつでも削除できます。コメントと分析の結果も一緒に削除されます。</li>
          <li>
            アカウントとすべてのデータの削除をご希望の場合は、登録したメールアドレスから {mail} までご連絡ください。
            依頼を受けてから{DELETION_REQUEST_DAYS}日以内に削除します。
          </li>
          <li>本サービスで削除しても、YouTube 上の動画やコメントには影響しません。</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="8. 安全のための取り組み">
        <LegalList>
          <li>API キーなどの秘密の情報は、サーバーだけで扱い、ブラウザには送りません。</li>
          <li>ログインユーザーのデータは、データベースの機能（行レベルセキュリティ）で、本人だけが読めるようにしています。</li>
          <li>通常の記録（ログ）には、コメントの本文を出力しません。</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="9. このポリシーの変更">
        <p>必要に応じて、このプライバシーポリシーを変更します。変更後の内容は、このページに掲載した時点から効力を持ちます。</p>
      </LegalSection>

      <LegalSection title="10. お問い合わせ">
        <p>
          情報の取り扱いに関するお問い合わせは、{OPERATOR_NAME}（{mail}）までご連絡ください。
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
