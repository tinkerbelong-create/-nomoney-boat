/**
 * 友達を招待する画面。
 *
 * 友達がいないとランキングが成り立たないので、
 * 「送る → 相手が登録する → 申請しあう」の3手順を1画面にまとめている。
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { ShareInvite } from '@/components/ShareInvite';
import { requireProfile, getBalance, getFriends } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function InvitePage() {
  const profile = await requireProfile();
  const [balance, friends] = await Promise.all([
    getBalance(profile.id),
    getFriends().catch(() => []),
  ]);

  // 公開URLは実際にアクセスされているホスト名から作る
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'nomoney-boat-web.vercel.app';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  const url = `${proto}://${host}`;

  const accepted = (friends as any[]).filter((f) => f.status === 'accepted');

  return (
    <>
      <Header title="友達を招待" balance={balance} back="/me" />

      <main className="pb-tab">
        <section className="px-4 py-5">
          <p className="text-sm leading-relaxed">
            このサイトは<strong>友達と収支を競う</strong>ためのものです。
            <br />
            誰か1人でも追加すると、ホームにランキングが出ます。
          </p>

          <div className="mt-4 rounded-xl border border-line p-4">
            <div className="text-[11px] text-sub">あなたのユーザーID</div>
            <div className="tabnum mt-0.5 text-xl font-bold">{profile.handle}</div>
            <div className="mt-0.5 text-xs text-sub">{profile.display_name}</div>
          </div>

          <div className="mt-4">
            <ShareInvite url={url} handle={profile.handle} />
          </div>
        </section>

        <section className="border-t border-line px-4 py-5">
          <h2 className="text-[11px] font-bold text-sub">相手にやってもらうこと</h2>
          <ol className="mt-2 space-y-3 text-sm leading-relaxed">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                1
              </span>
              <span>
                送ったURLを開いて、<strong>メールアドレスとパスワードで登録</strong>
                。確認メールのリンクを押してもらいます。
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                2
              </span>
              <span>
                好きな<strong>ユーザーIDと表示名</strong>を決めてもらいます。
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                3
              </span>
              <span>
                フレンド検索であなたのID「<strong>{profile.handle}</strong>」を探して
                <strong>申請</strong>。あなたが承認すれば対戦相手になります。
              </span>
            </li>
          </ol>

          <Link
            href="/friends"
            className="mt-5 block rounded-xl border border-line py-2.5 text-center text-sm font-semibold"
          >
            フレンド一覧・申請を見る
            {accepted.length > 0 && (
              <span className="ml-1 text-xs text-sub">（{accepted.length}人）</span>
            )}
          </Link>
        </section>

        <section className="border-t border-line px-4 py-5">
          <h2 className="text-[11px] font-bold text-sub">誘うときに伝えると親切なこと</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-sub">
            <li>お金は一切使いません。ポイントに換金性はありません。</li>
            <li>毎月1日に50,000ptが全員に配られ、月末で締めて翌月リセットです。</li>
            <li>締切を過ぎると投票できません。取消・変更もできません。</li>
            <li>結果はレース確定後、最大15分でポイントに反映されます。</li>
            <li>友達の投票は締切後にだけ見えます（真似を防ぐため）。</li>
          </ul>
        </section>
      </main>
    </>
  );
}
