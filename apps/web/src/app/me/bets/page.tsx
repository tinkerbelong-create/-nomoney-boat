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
import { RefreshResultButton } from '@/components/RefreshResultButton';
import { requireProfile, getBalance, getMyBets } from '@/lib/queries';
import { fmtPt, fmtSigned, fmtDate, fmtTime, profitColor } from '@/lib/format';
import { BOATRACE_BET_TYPES } from '@/core';

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
  const hits = settled.filter((b: any) => b.status === 'won').length;
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
            <div className="text-[10px] text-sub">的中</div>
            <div className="tabnum mt-0.5 text-base font-bold">
              {hits}
              <span className="text-[11px] font-normal text-sub">/{settled.length}</span>
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
          [...groups.values()].map(({ ev, list }) => {
            const total = list.reduce((s: number, b: any) => s + b.stake, 0);
            const back = list.reduce((s: number, b: any) => s + Number(b.payout), 0);
            const done = list.every((b: any) => b.status !== 'placed');
            const diff = back - total;

            return (
              <section key={ev?.id ?? Math.random()} className="border-b-8 border-gray-50">
                <Link
                  href={ev?.id ? `/races/${ev.id}` : '/races'}
                  className="flex items-center gap-2 bg-gray-50 px-4 py-2 active:bg-gray-100"
                >
                  <span className="text-sm font-bold">
                    {ev?.venue_name} {ev?.race_number}R
                  </span>
                  <span className="tabnum text-[11px] text-sub">
                    {fmtDate(ev?.deadline_at)} {fmtTime(ev?.deadline_at)}
                  </span>
                  <span className="ml-auto text-right">
                    {done ? (
                      <span className={`tabnum text-sm font-bold ${profitColor(diff)}`}>
                        {fmtSigned(diff)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-sub">結果待ち</span>
                    )}
                  </span>
                </Link>

                {/* 締切を過ぎているのに結果待ちのままなら、その場で取りに行けるようにする */}
                {!done &&
                  ev?.id &&
                  new Date(ev.deadline_at).getTime() < Date.now() && (
                    <div className="px-4 py-2">
                      <RefreshResultButton eventId={ev.id} />
                    </div>
                  )}

                <ul>
                  {list.map((b: any) => {
                    const bt = BOATRACE_BET_TYPES.find(
                      (x) => x.code === b.markets?.bet_type_code,
                    );
                    const d = b.status === 'placed' ? null : Number(b.payout) - b.stake;

                    return (
                      <li
                        key={b.id}
                        className={`flex items-center gap-2 border-b border-line px-4 py-2.5 ${
                          b.status === 'won' ? 'bg-amber-50' : ''
                        }`}
                      >
                        <span className="w-12 shrink-0 rounded bg-gray-100 px-1 py-0.5 text-center text-[10px] font-semibold text-sub">
                          {bt?.shortName}
                        </span>
                        <span className="tabnum flex-1 text-base font-bold tracking-wide">
                          {b.selection}
                        </span>
                        <span className="tabnum text-[11px] text-sub">{fmtPt(b.stake)}</span>

                        <span className="w-20 shrink-0 text-right">
                          {b.status === 'placed' && (
                            <span className="text-[11px] text-sub">結果待ち</span>
                          )}
                          {b.status === 'won' && (
                            <>
                              <div className="tabnum text-sm font-bold text-red-600">
                                {fmtPt(Number(b.payout))}
                              </div>
                              <div className={`tabnum text-[10px] ${profitColor(d!)}`}>
                                {fmtSigned(d!)}
                              </div>
                            </>
                          )}
                          {b.status === 'lost' && (
                            <span className="text-[11px] text-sub">外れ</span>
                          )}
                          {b.status === 'refunded' && (
                            <span className="text-[11px] text-sub">返還</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </main>

      <TabBar />
    </>
  );
}
