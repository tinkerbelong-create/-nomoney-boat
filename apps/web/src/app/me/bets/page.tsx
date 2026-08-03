/**
 * マイ舟券。
 *
 * 自分が買った舟券を、レースごとにまとめて見る画面。
 * 下のタブから直接ここに来られるようにしている（このアプリの主役の画面）。
 */

import Link from 'next/link';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { AutoRefresh } from '@/components/AutoRefresh';
import { MyRaceCard } from '@/components/MyRaceCard';
import { requireProfile, getBalance, getMyBets } from '@/lib/queries';
import { fmtSigned, profitColor } from '@/lib/format';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'all', label: 'すべて' },
  { key: 'open', label: '結果待ち' },
  { key: 'hit', label: '的中' },
] as const;

export default async function BetsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const sp = await searchParams;
  const f = (FILTERS.find((x) => x.key === sp.f)?.key ?? 'all') as 'all' | 'open' | 'hit';

  const profile = await requireProfile();
  const [balance, bets] = await Promise.all([getBalance(profile.id), getMyBets(300)]);

  // 集計
  const settled = bets.filter((b: any) => b.status === 'won' || b.status === 'lost');
  const stake = settled.reduce((s: number, b: any) => s + b.stake, 0);
  const payout = settled.reduce((s: number, b: any) => s + Number(b.payout), 0);
  // 的中は「レース単位」で数える（3連単20点のうち1点当たれば1レース的中）
  const settledRaces = new Set(settled.map((b: any) => b.markets?.events?.id));
  const hitRaces = new Set(
    settled.filter((b: any) => b.status === 'won').map((b: any) => b.markets?.events?.id),
  );
  const hits = hitRaces.size;
  const waiting = bets.filter((b: any) => b.status === 'placed').length;

  const shown = bets.filter((b: any) =>
    f === 'open' ? b.status === 'placed' : f === 'hit' ? b.status === 'won' : true,
  );

  // レースごとにまとめる
  const groups = new Map<string, { ev: any; list: any[] }>();
  for (const b of shown) {
    const ev = b.markets?.events;
    const key = ev?.id ?? 'unknown';
    if (!groups.has(key)) groups.set(key, { ev, list: [] });
    groups.get(key)!.list.push(b);
  }

  return (
    <>
      <Header title="マイ舟券" balance={balance} />
      {waiting > 0 && <AutoRefresh intervalMs={30_000} />}

      <main className="pb-tab">
        {/* まとめ */}
        <div className="grid grid-cols-3 gap-2 px-4 py-4 text-center">
          <div className="rounded-xl bg-gray-50 py-3">
            <div className="text-[10px] text-sub">通算収支</div>
            <div className={`tabnum mt-0.5 text-base font-bold ${profitColor(payout - stake)}`}>
              {fmtSigned(payout - stake)}
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 py-3">
            <div className="text-[10px] text-sub">的中レース</div>
            <div className="tabnum mt-0.5 text-base font-bold">
              {hits}
              <span className="text-[11px] font-normal text-sub">
                /{settledRaces.size}
              </span>
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 py-3">
            <div className="text-[10px] text-sub">結果待ち</div>
            <div className="tabnum mt-0.5 text-base font-bold">{waiting}</div>
          </div>
        </div>

        {/* 絞り込み */}
        <div className="grid grid-cols-3 border-b border-line">
          {FILTERS.map((x) => (
            <Link
              key={x.key}
              href={`/me/bets?f=${x.key}`}
              className={`py-2.5 text-center text-sm font-semibold ${
                x.key === f ? 'border-b-2 border-ink text-ink' : 'text-sub'
              }`}
            >
              {x.label}
            </Link>
          ))}
        </div>

        {groups.size === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-3xl">🎫</p>
            <p className="mt-3 text-sm font-semibold">
              {f === 'hit'
                ? 'まだ的中がありません'
                : f === 'open'
                  ? '結果待ちの舟券はありません'
                  : 'まだ舟券がありません'}
            </p>
            <Link
              href="/races"
              className="mt-5 inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white"
            >
              レースを見る
            </Link>
          </div>
        ) : (
          [...groups.values()].map(({ ev, list }) => (
            <MyRaceCard
              key={ev?.id ?? Math.random()}
              eventId={ev?.id}
              venueName={ev?.venue_name ?? ''}
              raceNumber={ev?.race_number ?? 0}
              deadlineAt={ev?.deadline_at}
              bets={list.map((b: any) => ({
                id: b.id,
                selection: b.selection,
                stake: b.stake,
                status: b.status,
                payout: Number(b.payout),
                betTypeCode: b.markets?.bet_type_code,
              }))}
            />
          ))
        )}
      </main>

      <TabBar />
    </>
  );
}
