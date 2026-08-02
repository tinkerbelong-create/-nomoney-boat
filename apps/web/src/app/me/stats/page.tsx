import { Header } from '@/components/Header';
import { TrendChart } from '@/components/TrendChart';
import {
  requireProfile,
  getBalance,
  getMyStats,
  getMonthlyTrend,
} from '@/lib/queries';
import { fmtSigned, fmtPct, profitColor } from '@/lib/format';
import { BOATRACE_BET_TYPES } from '@nmb/core';

export const dynamic = 'force-dynamic';

export default async function StatsPage() {
  const profile = await requireProfile();

  const [balance, stats, trend] = await Promise.all([
    getBalance(profile.id),
    getMyStats(profile.id, null),
    getMonthlyTrend(profile.id),
  ]);

  // 賭け式ごとに畳む
  const byBetType = new Map<
    string,
    { bet: number; hit: number; stake: number; payout: number }
  >();
  for (const s of stats) {
    const cur = byBetType.get(s.bet_type_code) ?? { bet: 0, hit: 0, stake: 0, payout: 0 };
    byBetType.set(s.bet_type_code, {
      bet: cur.bet + s.bet_count,
      hit: cur.hit + s.hit_count,
      stake: cur.stake + Number(s.total_stake),
      payout: cur.payout + Number(s.total_payout),
    });
  }

  return (
    <>
      <Header title="成績の詳細" balance={balance} back="/me" />

      <main className="pb-tab">
        <section className="border-b border-line px-4 py-4">
          <h2 className="mb-2 text-[11px] font-bold text-sub">月次の収支</h2>
          {trend.length === 0 ? (
            <p className="py-8 text-center text-xs text-sub">まだデータがありません</p>
          ) : (
            <TrendChart data={trend} />
          )}
        </section>

        <section>
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            賭け式別（通算）
          </h2>
          {byBetType.size === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-sub">まだ投票がありません</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] text-sub">
                  <th className="py-2 pl-4 text-left font-normal">賭け式</th>
                  <th className="py-2 text-right font-normal">戦</th>
                  <th className="py-2 text-right font-normal">的中率</th>
                  <th className="py-2 text-right font-normal">回収率</th>
                  <th className="py-2 pr-4 text-right font-normal">収支</th>
                </tr>
              </thead>
              <tbody>
                {BOATRACE_BET_TYPES.map((bt) => {
                  const s = byBetType.get(bt.code);
                  if (!s || s.bet === 0) return null;
                  const profit = s.payout - s.stake;
                  return (
                    <tr key={bt.code} className="border-b border-line">
                      <td className="py-2.5 pl-4 font-semibold">{bt.shortName}</td>
                      <td className="tabnum py-2.5 text-right text-xs">{s.bet}</td>
                      <td className="tabnum py-2.5 text-right text-xs">
                        {fmtPct((s.hit / s.bet) * 100)}
                      </td>
                      <td className="tabnum py-2.5 text-right text-xs">
                        {s.stake > 0 ? fmtPct((s.payout / s.stake) * 100) : '—'}
                      </td>
                      <td
                        className={`tabnum py-2.5 pr-4 text-right text-xs font-bold ${profitColor(
                          profit,
                        )}`}
                      >
                        {fmtSigned(profit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
