/**
 * 人のプロフィール。
 *
 * 自分・フレンド・同じ部屋の人が見られる。
 * 称号・自慢の的中・月ごとの成績を並べて、その人の「歴史」が見えるようにしている。
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import {
  requireProfile,
  getBalance,
  getProfileByHandle,
  getBadges,
  getRecentHits,
  getUserMonthly,
} from '@/lib/queries';
import { fmtPt, fmtSigned, fmtPct, fmtDate, profitColor } from '@/lib/format';
import { BOATRACE_BET_TYPES } from '@/core';

export const dynamic = 'force-dynamic';

export default async function UserPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const me = await requireProfile();
  const target = await getProfileByHandle(handle);
  if (!target) notFound();

  const [balance, badges, hits, monthly] = await Promise.all([
    getBalance(me.id),
    getBadges(target.id),
    getRecentHits(target.id, 8),
    getUserMonthly(target.id),
  ]);

  const isMe = target.id === me.id;
  const earned = badges.filter((b) => b.earned_at);

  // フレンドでも同じ部屋でもない相手には何も見せない
  if (!isMe && badges.length === 0) {
    return (
      <>
        <Header title={target.display_name} balance={balance} back="/rooms" />
        <main className="pb-tab px-6 py-16 text-center">
          <p className="text-3xl">🔒</p>
          <p className="mt-3 text-sm font-semibold">この人の成績は見られません</p>
          <p className="mt-1 text-xs leading-relaxed text-sub">
            フレンドになるか、同じ部屋に入ると見られます。
          </p>
          <Link
            href="/friends/search"
            className="mt-5 inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white"
          >
            フレンド申請する
          </Link>
        </main>
        <TabBar />
      </>
    );
  }

  const lifetime = (monthly as any[]).reduce(
    (a, m) => ({
      races: a.races + Number(m.race_count),
      hits: a.hits + Number(m.race_hit_count),
      profit: a.profit + Number(m.profit),
    }),
    { races: 0, hits: 0, profit: 0 },
  );

  return (
    <>
      <Header title={target.display_name} balance={balance} back="/rooms" />

      <main className="pb-tab">
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xl font-bold">
            {target.display_name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">{target.display_name}</div>
            <div className="text-xs text-sub">@{target.handle}</div>
          </div>
          {isMe && (
            <Link
              href="/me"
              className="ml-auto shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold"
            >
              マイページ
            </Link>
          )}
        </div>

        <section className="border-b border-line px-4 py-4">
          <h2 className="mb-3 text-[11px] font-bold text-sub">通算</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat
              label="収支"
              value={fmtSigned(lifetime.profit)}
              cls={profitColor(lifetime.profit)}
            />
            <Stat
              label="的中率"
              value={fmtPct(
                lifetime.races > 0 ? (lifetime.hits / lifetime.races) * 100 : null,
              )}
            />
            <Stat label="称号" value={`${earned.length}`} />
          </div>
          <p className="mt-3 text-center text-[11px] text-sub">
            {lifetime.races}レース {lifetime.hits}的中
          </p>
        </section>

        <section className="border-b-8 border-gray-50">
          <h2 className="flex items-baseline justify-between bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            <span>称号</span>
            <span className="font-normal">
              {earned.length} / {badges.length}
            </span>
          </h2>
          {earned.length === 0 ? (
            <p className="px-4 py-4 text-xs text-sub">まだありません。</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 px-4 py-3">
              {earned.slice(0, 24).map((b) => (
                <span
                  key={b.code}
                  title={b.description}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                    b.rarity === 'crown'
                      ? 'border-violet-300 bg-violet-50 text-violet-900'
                      : b.rarity === 'gold'
                        ? 'border-yellow-300 bg-yellow-50 text-yellow-900'
                        : b.rarity === 'silver'
                          ? 'border-slate-300 bg-slate-50 text-slate-800'
                          : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  {b.rarity === 'crown' ? '👑 ' : '★ '}
                  {b.name}
                </span>
              ))}
              {earned.length > 24 && (
                <span className="self-center text-[11px] text-sub">
                  ほか{earned.length - 24}個
                </span>
              )}
            </div>
          )}
        </section>

        <section className="border-b-8 border-gray-50">
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            自慢の的中（払戻の大きい順）
          </h2>
          {(hits as any[]).length === 0 ? (
            <p className="px-4 py-4 text-xs text-sub">まだありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {(hits as any[]).map((h) => {
                const bt = BOATRACE_BET_TYPES.find((x) => x.code === h.bet_type_code);
                return (
                  <li key={h.bet_id}>
                    <Link
                      href={`/races/${h.event_id}`}
                      className="flex items-center gap-2 px-4 py-2.5 active:bg-gray-50"
                    >
                      <span className="w-12 shrink-0 rounded bg-gray-100 px-1 py-0.5 text-center text-[10px] font-semibold text-sub">
                        {bt?.shortName}
                      </span>
                      <span className="tabnum shrink-0 text-base font-bold">
                        {h.selection}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-sub">
                        {h.venue_name} {h.race_number}R ・ {fmtDate(h.deadline_at)}
                      </span>
                      <span className="tabnum shrink-0 text-right">
                        <span className="block text-sm font-bold text-red-600">
                          {fmtPt(Number(h.payout))}
                        </span>
                        <span className="block text-[10px] text-sub">
                          {Math.round((Number(h.payout) / h.stake) * 10) / 10}倍
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            月ごとの成績
          </h2>
          {(monthly as any[]).length === 0 ? (
            <p className="px-4 py-4 text-xs text-sub">まだありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {(monthly as any[]).map((m) => (
                <li key={m.season_code} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="tabnum w-20 shrink-0 text-sm font-bold">
                    {monthLabel(m.season_code)}
                  </span>
                  <span className="tabnum flex-1 text-[11px] text-sub">
                    {m.race_count}レース {m.race_hit_count}的中 ・ 回収 {fmtPct(m.roi_pct)}
                  </span>
                  <span
                    className={`tabnum shrink-0 text-sm font-bold ${profitColor(
                      Number(m.profit),
                    )}`}
                  >
                    {fmtSigned(Number(m.profit))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="h-6" />
      </main>

      <TabBar />
    </>
  );
}

function Stat({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 py-3">
      <div className="text-[10px] text-sub">{label}</div>
      <div className={`tabnum mt-0.5 text-base font-bold ${cls}`}>{value}</div>
    </div>
  );
}

/** '2026-08' → '2026年8月' */
function monthLabel(seasonCode: string): string {
  const [y, m] = seasonCode.split('-');
  return `${y}年${Number(m)}月`;
}
