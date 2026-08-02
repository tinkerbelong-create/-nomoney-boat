import { Header } from '@/components/Header';
import { requireProfile, getBalance, getMyBets } from '@/lib/queries';
import { fmtPt, fmtSigned, fmtDate, profitColor } from '@/lib/format';
import { BOATRACE_BET_TYPES } from '@nmb/core';

export const dynamic = 'force-dynamic';

export default async function BetsPage() {
  const profile = await requireProfile();

  const [balance, bets] = await Promise.all([getBalance(profile.id), getMyBets(150)]);

  return (
    <>
      <Header title="投票履歴" balance={balance} back="/me" />

      <main className="pb-tab">
        {bets.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-sub">
            まだ投票がありません。
          </p>
        ) : (
          <ul>
            {bets.map((b: any) => {
              const bt = BOATRACE_BET_TYPES.find((x) => x.code === b.markets?.bet_type_code);
              const ev = b.markets?.events;
              const diff = b.status === 'placed' ? null : Number(b.payout) - b.stake;

              return (
                <li key={b.id} className="border-b border-line px-4 py-3">
                  <div className="flex items-baseline gap-2 text-[11px] text-sub">
                    <span>{fmtDate(ev?.deadline_at ?? b.created_at)}</span>
                    <span className="truncate">
                      {ev?.venue_name} {ev?.race_number}R
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-sub">
                      {bt?.shortName}
                    </span>
                    <span className="tabnum text-sm font-bold">{b.selection}</span>
                    <span className="tabnum text-[11px] text-sub">{fmtPt(b.stake)}</span>

                    <span className="ml-auto text-right">
                      {b.status === 'placed' && (
                        <span className="text-[11px] text-sub">結果待ち</span>
                      )}
                      {b.status === 'won' && (
                        <>
                          <div className="tabnum text-sm font-bold text-red-600">
                            {fmtPt(Number(b.payout))}
                          </div>
                          <div className={`tabnum text-[10px] ${profitColor(diff!)}`}>
                            {fmtSigned(diff!)}
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
