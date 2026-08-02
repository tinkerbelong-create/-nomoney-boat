import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { supabaseServer } from '@/lib/supabase';
import { requireProfile, getBalance, getMyStats, currentSeasonCode } from '@/lib/queries';
import { fmtSigned, fmtPct, profitColor } from '@/lib/format';
import { BOATRACE_BET_TYPES } from '@nmb/core';

export const dynamic = 'force-dynamic';

export default async function UserPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const me = await requireProfile();

  const supabase = await supabaseServer();
  const { data: target } = await supabase
    .from('profiles')
    .select('id, handle, display_name')
    .eq('handle', handle)
    .maybeSingle();

  if (!target) notFound();

  const [balance, stats] = await Promise.all([
    getBalance(me.id),
    getMyStats(target.id, currentSeasonCode()),
  ]);

  const totals = stats.reduce(
    (a, s) => ({
      bet: a.bet + s.bet_count,
      hit: a.hit + s.hit_count,
      stake: a.stake + Number(s.total_stake),
      payout: a.payout + Number(s.total_payout),
    }),
    { bet: 0, hit: 0, stake: 0, payout: 0 },
  );
  const profit = totals.payout - totals.stake;

  return (
    <>
      <Header title={target.display_name} balance={balance} back="/friends" />

      <main className="pb-tab">
        <div className="border-b border-line px-4 py-4">
          <div className="text-lg font-bold">{target.display_name}</div>
          <div className="text-xs text-sub">@{target.handle}</div>
        </div>

        <section className="border-b border-line px-4 py-4">
          <h2 className="mb-3 text-[11px] font-bold text-sub">今月の成績</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-gray-50 py-3">
              <div className="text-[10px] text-sub">収支</div>
              <div className={`tabnum mt-0.5 text-base font-bold ${profitColor(profit)}`}>
                {fmtSigned(profit)}
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 py-3">
              <div className="text-[10px] text-sub">回収率</div>
              <div className="tabnum mt-0.5 text-base font-bold">
                {fmtPct(totals.stake > 0 ? (totals.payout / totals.stake) * 100 : null)}
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 py-3">
              <div className="text-[10px] text-sub">的中率</div>
              <div className="tabnum mt-0.5 text-base font-bold">
                {fmtPct(totals.bet > 0 ? (totals.hit / totals.bet) * 100 : null)}
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-sub">
            {totals.bet}戦 {totals.hit}的中
          </p>
        </section>

        <section>
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            賭け式別（今月）
          </h2>
          {stats.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-sub">まだ投票がありません</p>
          ) : (
            <ul>
              {BOATRACE_BET_TYPES.map((bt) => {
                const s = stats.find((x) => x.bet_type_code === bt.code);
                if (!s || s.bet_count === 0) return null;
                const p = Number(s.total_payout) - Number(s.total_stake);
                return (
                  <li
                    key={bt.code}
                    className="flex items-center gap-3 border-b border-line px-4 py-2.5"
                  >
                    <span className="w-14 text-sm font-semibold">{bt.shortName}</span>
                    <span className="tabnum flex-1 text-xs text-sub">
                      {s.bet_count}戦 {s.hit_count}的中
                    </span>
                    <span className={`tabnum text-sm font-bold ${profitColor(p)}`}>
                      {fmtSigned(p)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
