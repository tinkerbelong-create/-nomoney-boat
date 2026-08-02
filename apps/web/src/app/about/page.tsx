import { Header } from '@/components/Header';
import { SETTLE_DELAY_MIN } from '@/lib/settings';

export default function AboutPage() {
  return (
    <>
      <Header title="このサイトについて" back="/me" />

      <main className="space-y-6 px-5 py-6 text-sm leading-relaxed">
        <section>
          <h2 className="mb-2 text-base font-bold">お金は一切かかりません</h2>
          <p className="text-sub">
            このサイトで使うのはポイントだけです。ポイントの購入はできません。
            現金・電子マネー・暗号資産・景品など、
            <strong className="text-ink">
              換金できるもの・金銭的価値のあるものとの交換は一切できません。
            </strong>
            ユーザー同士でポイントを受け渡すこともできません。
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">ポイントの仕組み</h2>
          <ul className="list-disc space-y-1 pl-5 text-sub">
            <li>毎月1日に全員へ50,000ptが配られます</li>
            <li>月末で締め、翌月はまた50,000ptからのスタートです</li>
            <li>過去の月の成績はいつでも振り返れます</li>
            <li>持ちポイントは、これまでの増減の積み上げで計算しています</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">遊び方</h2>
          <p className="text-sub">
            実際のボートレースの出走表を見て、賭け式（3連単・3連複・2連単・2連複・
            単勝・複勝）と買い目を選び、ポイントを賭けます。
            発走時刻で自動的に締め切られ、以降は変更も取消もできません。
            レースが確定すると、実際の払戻金と同じ倍率でポイントが払い戻されます。
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">結果の反映について</h2>
          <p className="text-sub">
            締切はレースの発走時刻ちょうどで、1秒のずれもありません。
            <br />
            ただし
            <strong className="text-ink">
              結果とポイントの反映には、レース確定後さらに最大{SETTLE_DELAY_MIN}
              分ほどかかります。
            </strong>
            公式サイトの結果を定期的に取りに行く仕組みのためです。
            レースが終わってすぐポイントが動かなくても、しばらくお待ちください。
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">舟券は買えません</h2>
          <p className="text-sub">
            このサイトから実際の舟券を購入することはできません。
            購入サイトへのリンクも置いていません。
            レースの結果を題材にした、友達同士の予想くらべのためのサイトです。
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">データについて</h2>
          <p className="text-sub">
            出走表・レース結果・払戻金は、BOAT RACE オフィシャルウェブサイトで
            公開されている情報をもとにしています。
            情報の正確性・完全性を保証するものではありません。
            <br />
            データ出典: BOAT RACE オフィシャルウェブサイト
          </p>
        </section>

        <section className="rounded-xl bg-gray-50 p-4">
          <p className="text-xs text-sub">
            本サイトは公営競技の結果を題材にした非営利のファンサイトであり、
            主催者・施行者とは一切関係ありません。
          </p>
        </section>
      </main>
    </>
  );
}
