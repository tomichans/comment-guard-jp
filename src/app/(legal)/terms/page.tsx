import type { Metadata } from "next";
import Link from "next/link";

import {
  ExternalLink,
  LegalDocument,
  LegalList,
  LegalSection,
} from "@/components/legal/legal-document";
import {
  GUEST_DAILY_VIDEO_LIMIT,
  GUEST_MAX_THREADS,
  USER_DAILY_VIDEO_LIMIT,
  USER_MAX_THREADS,
} from "@/lib/config/limits";
import { GUEST_RETENTION_HOURS, USER_RETENTION_DAYS } from "@/lib/config/retention";
import { CONTACT_EMAIL, OPERATOR_NAME } from "@/lib/config/site";

export const metadata: Metadata = { title: "利用規約 | CommentGuard JP" };

// 利用規約（要件定義書18.3）。数値（保持期間・上限）は定数から表示し、コードと文章がずれないようにする。
export default function TermsPage() {
  return (
    <LegalDocument title="利用規約">
      <p>
        この利用規約（以下「本規約」）は、{OPERATOR_NAME}（以下「運営者」）が提供する CommentGuard JP
        （以下「本サービス」）の利用条件を定めるものです。本サービスを利用した時点で、本規約に同意したものとみなします。
      </p>

      <LegalSection title="第1条　本サービスの内容">
        <p>
          本サービスは、YouTube の動画に寄せられた公開コメントを取得し、AI とルールで分類・集計して、
          発信者がコメントを安全かつ効率的に読めるよう支援する Web アプリです。
          運営者が個人で開発・運営する、無料の試作版（ポートフォリオ）です。
        </p>
      </LegalSection>

      <LegalSection title="第2条　YouTube の利用規約">
        <p>
          本サービスは YouTube API Services を利用しています。本サービスを利用する方は、YouTube の利用規約
          （<ExternalLink href="https://www.youtube.com/t/terms" />）にも同意したものとみなします。
        </p>
      </LegalSection>

      <LegalSection title="第3条　利用の方法と上限">
        <LegalList>
          <li>
            ログインせずに、ゲストとして利用できます。ゲストが同時に保存できる動画は1本、取得するコメントは最新の
            {GUEST_MAX_THREADS}件までで、同じ通信元から分析できる動画は1日{GUEST_DAILY_VIDEO_LIMIT}本までです。
          </li>
          <li>
            メールアドレスとパスワードでアカウントを登録すると、複数の動画を保存でき、取得するコメントは
            {USER_MAX_THREADS}件まで、分析できる動画は1人1日{USER_DAILY_VIDEO_LIMIT}本までです。
          </li>
          <li>費用を抑えるため、本サービス全体でも1日に分析できる動画の数に上限があります。</li>
          <li>上限の値は、予告なく変更することがあります。</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="第4条　アカウント">
        <p>
          登録したメールアドレスとパスワードは、ご自身で管理してください。第三者に使われたことによる損害について、
          運営者は責任を負いません。
        </p>
      </LegalSection>

      <LegalSection title="第5条　データの保存と削除">
        <LegalList>
          <li>
            取得した動画の情報、コメント、分析結果は、ゲストは{GUEST_RETENTION_HOURS}時間、ログインユーザーは最長
            {USER_RETENTION_DAYS}日で自動的に削除されます。
          </li>
          <li>ログインユーザーは、保存した動画をいつでも削除できます。</li>
          <li>本サービスで削除しても、YouTube 上の動画やコメントには影響しません。</li>
          <li>
            詳しくは<Link href="/privacy" className="underline underline-offset-4">プライバシーポリシー</Link>
            をご覧ください。
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="第6条　禁止事項">
        <p>本サービスの利用にあたって、次の行為を禁止します。</p>
        <LegalList>
          <li>法令または公序良俗に反する行為</li>
          <li>本サービスのサーバーやネットワークに過度な負荷をかける行為、プログラムによる大量の自動操作</li>
          <li>本サービスへの不正アクセス、利用上限を不正に回避する行為</li>
          <li>他人のアカウントを使う行為、他人になりすます行為</li>
          <li>分析結果を、コメントの投稿者への嫌がらせや攻撃に使う行為</li>
          <li>その他、運営者が不適切と判断する行為</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="第7条　分析結果について">
        <p>
          コメントの分類、ランキング、AI のアドバイスは、AI とルールによる自動の判定で、誤りを含むことがあります。
          内容の正確さや有用性は保証しません。最終的な判断は、ご自身で行ってください。
        </p>
      </LegalSection>

      <LegalSection title="第8条　サービスの変更・停止・終了">
        <p>
          運営者は、予告なく本サービスの内容を変更し、または提供を停止・終了することがあります。
          保存されたデータが失われることもあります。
        </p>
      </LegalSection>

      <LegalSection title="第9条　免責">
        <p>
          本サービスは現状のまま提供します。本サービスの利用、または利用できなかったことによって生じた損害について、
          運営者は、運営者の故意または重大な過失による場合を除き、責任を負いません。
        </p>
      </LegalSection>

      <LegalSection title="第10条　本規約の変更">
        <p>運営者は、必要に応じて本規約を変更できます。変更後の本規約は、このページに掲載した時点から効力を持ちます。</p>
      </LegalSection>

      <LegalSection title="第11条　お問い合わせ">
        <p>
          本サービスに関するお問い合わせは、{OPERATOR_NAME}（
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>
          ）までご連絡ください。
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
