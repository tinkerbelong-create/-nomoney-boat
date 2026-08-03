/**
 * 称号のコレクション画面。
 *
 * 取ったものは色つき、まだのものは灰色で「何をすれば取れるか」を出す。
 * 見えているから狙いにいける、というのが称号の面白さなので、
 * 未取得もぜんぶ並べる。
 */

import Link from 'next/link';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { requireProfile, getBalance, getBadges, type BadgeRow } from '@/lib/queries';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'title', label: '月間タイトル' },
  { key: 'start', label: 'はじめの一歩' },
  { key: 'count', label: '的中の数' },
  { key: 'streak', label: '連続的中' },
  { key: 'payout', label: '高配当' },
  { key: 'bettype', label: '賭け式' },
  { key: 'style', label: '買い方' },
  { key: 'lane', label: '艇番のクセ' },
  { key: 'venue', label: '場めぐり' },
  { key: 'money', label: '収支' },
  { key: 'habit', label: '習慣' },
  { key: 'feature', label: 'お題レース' },
  { key: 'social', label: '対戦' },
  { key: 'racer', label: '選手' },
  { key: 'lose', label: '不名誉' },
  { key: 'meta', label: 'コレクション' },
];

const RARITY: Record<string, { label: string; on: string; ring: string }> = {
  bronze: { label: '', on: 'bg-amber-50 text-amber-900', ring: 'border-amber-200' },
  silver: { label: '', on: 'bg-slate-100 text-slate-800', ring: 'border-slate-300' },
  gold: { label: '', on: 'bg-yellow-100 text-yellow-900', ring: 'border-yellow-400' },
  crown: { label: '👑', on: 'bg-violet-100 text-violet-900', ring: 'border-violet-400' },
};

export default async function BadgesPage() {
  const profile = await requireProfile();
  const [balance, badges] = await Promise.all([
    getBalance(profile.id),
    getBadges(profile.id),
  ]);

  const earned = badges.filter((b) => b.earned_at);
  const byCategory = new Map<string, BadgeRow[]>();
  for (const b of badges) {
    if (!byCategory.has(b.category)) byCategory.set(b.category, []);
    byCategory.get(b.category)!.push(b);
  }

  return (
    <>
      <Header title="称号" balance={balance} back="/me" />

      <main className="pb-tab">
        <div className="border-b border-line px-4 py-4 text-center">
          <div className="tabnum text-3xl font-bold">
            {earned.length}
            <span className="text-base font-normal text-sub"> / {badges.length}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-sub">獲得した称号</div>
          <div className="mx-auto mt-3 h-2 w-full max-w-xs overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
              style={{
                width: `${badges.length > 0 ? (earned.length / badges.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {earned.length > 0 && (
          <section className="border-b-8 border-gray-50">
            <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
              最近とった称号
            </h2>
            <ul className="divide-y divide-line">
              {[...earned]
                .sort((a, b) => (b.earned_at! > a.earned_at! ? 1 : -1))
                .slice(0, 5)
                .map((b) => (
                  <BadgeRowView key={b.code} badge={b} />
                ))}
            </ul>
          </section>
        )}

        {CATEGORIES.filter((c) => byCategory.has(c.key)).map((c) => {
          const list = byCategory.get(c.key)!;
          const got = list.filter((b) => b.earned_at).length;
          return (
            <section key={c.key} className="border-b-8 border-gray-50">
              <h2 className="flex items-baseline justify-between bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
                <span>{c.label}</span>
                <span className="tabnum font-normal">
                  {got} / {list.length}
                </span>
              </h2>
              <ul className="divide-y divide-line">
                {list.map((b) => (
                  <BadgeRowView key={b.code} badge={b} />
                ))}
              </ul>
            </section>
          );
        })}

        <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-sub">
          称号はレースが確定したときに自動で付きます。
          <br />
          月間タイトルは翌月の1日に決まります。
        </p>

        <div className="px-4 pb-6 text-center">
          <Link href="/races" className="text-xs font-semibold text-sub underline">
            レースを見る →
          </Link>
        </div>
      </main>

      <TabBar />
    </>
  );
}

function BadgeRowView({ badge }: { badge: BadgeRow }) {
  const r = RARITY[badge.rarity] ?? RARITY.bronze;
  const got = !!badge.earned_at;

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2
                    text-lg ${got ? `${r.on} ${r.ring}` : 'border-gray-200 bg-gray-50 text-gray-300'}`}
      >
        {got ? (badge.rarity === 'crown' ? '👑' : '★') : '☆'}
      </span>

      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-bold ${got ? '' : 'text-gray-400'}`}>
          {badge.name}
        </div>
        <div className="truncate text-[11px] text-sub">{badge.description}</div>
      </div>

      {got && (
        <span className="tabnum shrink-0 text-[10px] text-sub">
          {fmtDate(badge.earned_at!)}
        </span>
      )}
    </li>
  );
}
