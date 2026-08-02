/**
 * タイムライン。
 * フレンドが何に投票し、的中したかが流れる。
 * RLS により、締切前の投票はそもそも取得できない（真似防止）。
 */

import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { requireProfile, getBalance, getTimeline } from '@/lib/queries';
import { fmtPt, fmtSigned, profitColor } from '@/lib/format';
import { settleDelayText } from '@/lib/settings';
import { BOATRACE_BET_TYPES } from '@nmb/core';

export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
  const profile = await requireProfile();

  const [balance, rows] = await Promise.all([getBalance(profile.id), getTimeline(60)]);

  return (
    <>
      <Header title="みんなの投票" balance={balance} />

      <main className="pb-tab">
        <p className="border-b border-line bg-gray-50 px-4 py-1.5 text-[10px] text-sub">
          投票内容は締切後に表示されます。{settleDelayText}。
        </p>
        {rows.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-sub">
            まだ何も流れていません。
            <br />
            フレンドが投票して締切を迎えると、ここに出ます。
          </p>
        ) : (
          <ul>
            {rows.map((r: any) => {
              const bt = BOATRACE_BET_TYPES.find((x) => x.code === r.bet_type_code);
              const diff = r.status === 'placed' ? null : Number(r.payout) - r.stake;
              const isMe = r.user_id === profile.id;

              return (
                <li key={r.bet_id} className="border-b border-line px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">
                      {isMe ? 'あなた' : r.display_name}
                    </span>
                    <span className="truncate text-[11px] text-sub">
                      {r.venue_name} {r.race_number}R
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-sub">
                      {bt?.shortName ?? r.bet_type_code}
                    </span>
                    <span className="tabnum text-sm font-bold">{r.selection}</span>
                    <span className="tabnum text-[11px] text-sub">{fmtPt(r.stake)}</span>

                    <span className="ml-auto">
                      {r.status === 'placed' && (
                        <span className="text-[11px] text-sub">結果待ち</span>
                      )}
                      {r.status === 'won' && (
                        <span className={`tabnum text-sm font-bold ${profitColor(diff!)}`}>
                          🎯 {fmtSigned(diff!)}
                        </span>
                      )}
                      {r.status === 'lost' && (
                        <span className="text-[11px] text-sub">外れ</span>
                      )}
                      {r.status === 'refunded' && (
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

      <TabBar />
    </>
  );
}
