/**
 * 出走表 + 投票 + 結果。
 * 1レースに関することはこの画面で完結する。
 */

import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { Countdown } from '@/components/Countdown';
import { AutoRefresh } from '@/components/AutoRefresh';
import { BetPanel } from '@/components/BetPanel';
import {
  requireProfile,
  getBalance,
  getEvent,
  getMyBetsForEvent,
  getMarketResults,
} from '@/lib/queries';
import { fmtTime, fmtPt, fmtSigned, laneClass, profitColor } from '@/lib/format';
import { settleWaitingText } from '@/lib/settings';
import { BOATRACE_BET_TYPES } from '@/core';

export const dynamic = 'force-dynamic';

export default async function RaceDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  const profile = await requireProfile();

  const [balance, event] = await Promise.all([getBalance(profile.id), getEvent(eventId)]);
  if (!event) notFound();

  const [myBets, results] = await Promise.all([
    getMyBetsForEvent(eventId),
    getMarketResults((event.markets ?? []).map((m: any) => m.id)),
  ]);

  const serverNow = Date.now();
  const isOpen =
    event.status === 'scheduled' && new Date(event.deadline_at).getTime() > serverNow;

  const entrants = [...(event.event_entrants ?? [])].sort(
    (a: any, b: any) => a.sort_order - b.sort_order,
  );
  const eventResult = Array.isArray(event.event_results)
    ? event.event_results[0]
    : event.event_results;

  return (
    <>
      <Header
        title={`${event.venue_name} ${event.race_number}R`}
        balance={balance}
        back="/races"
      />
      {/* 結果が出るまでは短い間隔で、確定後は更新不要なので止める */}
      {event.status !== 'resolved' && event.status !== 'cancelled' && (
        <AutoRefresh intervalMs={20_000} />
      )}

      <main className="pb-tab">
        {/* レース概要 */}
        <div className="border-b border-line px-4 py-3">
          <div className="text-xs text-sub">{event.title}</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="tabnum text-lg font-bold">{fmtTime(event.deadline_at)}</span>
            <span className="text-xs text-sub">締切</span>
            {isOpen && (
              <Countdown
                deadline={event.deadline_at}
                serverNow={serverNow}
                className="!text-xs"
              />
            )}
            {event.status === 'cancelled' && (
              <span className="text-xs font-bold text-red-600">中止（全額返還）</span>
            )}
          </div>

          {/* 締切後・結果待ちのあいだ、待ち時間を明示する。
              「レースは終わったのにポイントが増えない」と不安にさせないため。 */}
          {event.status === 'closed' && !eventResult && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              締め切りました。結果を集計中です。
              <br />
              {settleWaitingText}。しばらくお待ちください。
            </p>
          )}
        </div>

        {/* 出走表 */}
        <section>
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">出走表</h2>
          {entrants.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-sub">
              出走表はまだ公開されていません。
            </p>
          ) : (
            <ul>
              {entrants.map((e: any) => (
                <li key={e.slot_code} className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm font-bold ${laneClass(
                      e.slot_code,
                    )}`}
                  >
                    {e.slot_code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{e.name}</div>
                    <div className="tabnum text-[11px] text-sub">
                      {e.meta?.racerClass && <span className="mr-2">{e.meta.racerClass}</span>}
                      {e.meta?.racerId && <span className="mr-2">#{e.meta.racerId}</span>}
                      {Array.isArray(e.meta?.rates) && e.meta.rates.length > 0 && (
                        <span>勝率 {e.meta.rates[0]}</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 結果 */}
        {eventResult && (
          <section>
            <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">結果</h2>
            <ul className="px-4 py-2">
              {(eventResult.placings ?? []).map((p: any) => (
                <li key={p.rank} className="flex items-center gap-3 py-1">
                  <span className="w-6 text-sm font-bold">{p.rank}着</span>
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded text-xs font-bold ${laneClass(
                      p.slot,
                    )}`}
                  >
                    {p.slot}
                  </span>
                  <span className="flex-1 truncate text-sm">{p.name}</span>
                  <span className="tabnum text-xs text-sub">{p.time ?? ''}</span>
                </li>
              ))}
            </ul>

            {results.length > 0 && (
              <div className="border-t border-line px-4 py-2">
                <div className="mb-1 text-[11px] font-bold text-sub">払戻金（100ptあたり）</div>
                <table className="w-full text-sm">
                  <tbody>
                    {BOATRACE_BET_TYPES.map((bt) => {
                      const marketId = (event.markets ?? []).find(
                        (m: any) => m.bet_type_code === bt.code,
                      )?.id;
                      const rows = results.filter((r: any) => r.market_id === marketId);
                      if (rows.length === 0) return null;
                      return rows.map((r: any, i: number) => (
                        <tr key={`${bt.code}-${r.winning_selection}`} className="border-b border-line/60">
                          <td className="py-1 text-xs text-sub">{i === 0 ? bt.name : ''}</td>
                          <td className="tabnum py-1 font-semibold">{r.winning_selection}</td>
                          <td className="tabnum py-1 text-right font-bold">
                            {r.payout_per_100.toLocaleString()}
                          </td>
                          <td className="tabnum py-1 pl-2 text-right text-[11px] text-sub">
                            {r.popularity ? `${r.popularity}番人気` : ''}
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* 自分の投票 */}
        {myBets.length > 0 && (
          <section>
            <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
              あなたの投票
            </h2>
            <ul>
              {myBets.map((b: any) => {
                const bt = BOATRACE_BET_TYPES.find(
                  (x) => x.code === (b.markets?.bet_type_code ?? ''),
                );
                const diff = b.status === 'placed' ? null : b.payout - b.stake;
                return (
                  <li
                    key={b.id}
                    className="flex items-center gap-3 border-b border-line px-4 py-2.5"
                  >
                    <span className="w-14 shrink-0 text-xs text-sub">{bt?.shortName}</span>
                    <span className="tabnum flex-1 font-bold">{b.selection}</span>
                    <span className="tabnum text-xs text-sub">{fmtPt(b.stake)}</span>
                    <span className="w-20 shrink-0 text-right">
                      {b.status === 'placed' && (
                        <span className="text-xs text-sub">
                          {event.status === 'scheduled' ? '投票済' : '結果待ち'}
                        </span>
                      )}
                      {b.status === 'won' && (
                        <span className={`tabnum text-sm font-bold ${profitColor(diff!)}`}>
                          {fmtSigned(diff!)}
                        </span>
                      )}
                      {b.status === 'lost' && <span className="text-xs text-sub">外れ</span>}
                      {b.status === 'refunded' && (
                        <span className="text-xs text-sub">返還</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* 投票 */}
        {isOpen && entrants.length > 0 && (
          <BetPanel
            eventId={event.id}
            markets={(event.markets ?? []).map((m: any) => ({
              id: m.id,
              betTypeCode: m.bet_type_code,
              minStake: m.min_stake,
              stakeStep: m.stake_step,
            }))}
            lanes={entrants.map((e: any) => e.slot_code)}
            balance={balance}
            deadline={event.deadline_at}
            serverNow={serverNow}
          />
        )}
      </main>

      <TabBar />
    </>
  );
}
