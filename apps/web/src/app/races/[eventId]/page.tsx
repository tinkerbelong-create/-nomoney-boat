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
  getFavoriteRacers,
  getFeatureForEvent,
  getTournamentsForEvent,
  calcCashback,
} from '@/lib/queries';
import { EntrantList } from '@/components/EntrantList';
import { RefreshResultButton } from '@/components/RefreshResultButton';
import { BeforeInfoPanel } from '@/components/BeforeInfoPanel';
import { fmtTime, fmtPt, fmtSigned, laneClass, profitColor, officialLinks } from '@/lib/format';
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

  const [myBets, results, favorites, feature] = await Promise.all([
    getMyBetsForEvent(eventId),
    getMarketResults((event.markets ?? []).map((m: any) => m.id)),
    getFavoriteRacers(),
    getFeatureForEvent(eventId),
  ]);
  const joinable = isOpenLater(event) ? await getTournamentsForEvent(eventId, event.deadline_at) : [];
  // お題レースで自分がすでに使ったポイント
  const featureUsed = feature
    ? myBets.reduce((s: number, b: any) => s + (b.status === 'refunded' ? 0 : b.stake), 0)
    : 0;
  const favSet = new Set(favorites.map((f) => f.racer_id));

  const serverNow = Date.now();
  const isOpen =
    event.status === 'scheduled' && new Date(event.deadline_at).getTime() > serverNow;

  const entrants = [...(event.event_entrants ?? [])].sort(
    (a: any, b: any) => a.sort_order - b.sort_order,
  );
  const official = officialLinks(event.external_key);
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
        {/* お題レースの帯 */}
        {feature && (
          <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-white">
            <div className="flex items-center gap-2">
              <span className="rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">
                今日のお題
              </span>
              <span className="rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                {Math.round(feature.cashbackRate * 100)}%キャッシュバック
              </span>
            </div>
            <div className="tabnum mt-1 text-[11px] text-white/90">
              賭けた額の{Math.round(feature.cashbackRate * 100)}%が戻ります。当たっても外れても。
              最大{fmtPt(feature.cashbackMax)}。
              {featureUsed > 0 && (
                <>
                  {' '}
                  いま {fmtPt(featureUsed)} 投票中 →{' '}
                  <b>
                    {fmtPt(
                      calcCashback(featureUsed, feature.cashbackRate, feature.cashbackMax),
                    )}
                  </b>{' '}
                  戻ります
                </>
              )}
            </div>
          </div>
        )}

        {/* レース概要 */}
        <div className="border-b border-line px-4 py-3">
          <div className="text-xs text-sub">{event.title}</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="tabnum text-2xl font-bold">{fmtTime(event.deadline_at)}</span>
            <span className="text-xs text-sub">締切</span>
            {isOpen && (
              <Countdown
                deadline={event.deadline_at}
                serverNow={serverNow}
                className="!text-sm !font-bold"
              />
            )}
            {event.status === 'cancelled' && (
              <span className="text-xs font-bold text-red-600">中止（全額返還）</span>
            )}
          </div>

          {/* 締切後・結果待ちのあいだ、待ち時間を明示する。
              「レースは終わったのにポイントが増えない」と不安にさせないため。 */}
          {!eventResult && event.status !== 'scheduled' && event.status !== 'cancelled' && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2.5">
              <p className="text-[11px] leading-relaxed text-amber-900">
                締め切りました。結果を集計中です。
                <br />
                {settleWaitingText}。待てない場合は下のボタンを押してください。
              </p>
              <div className="mt-2">
                <RefreshResultButton eventId={event.id} />
              </div>
            </div>
          )}
        </div>

        {/* 公式サイトの詳しい情報。展示タイムや気象までは取り込んでいないので、
            予想したい人はここから公式へ飛べるようにしている。 */}
        {official && (
          <div className="flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5">
            {[
              { href: official.racelist, label: '出走表' },
              { href: official.beforeinfo, label: '直前情報' },
              { href: official.odds, label: 'オッズ' },
              { href: official.result, label: '結果' },
            ].map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-sub"
              >
                {l.label} ↗
              </a>
            ))}
          </div>
        )}

        {/* 出走表 */}
        <section>
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">出走表</h2>
          {entrants.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-sub">
              出走表はまだ公開されていません。
            </p>
          ) : (
            <EntrantList
              eventId={event.id}
              entrants={entrants.map((e: any) => ({
                slot_code: e.slot_code,
                name: e.name,
                meta: e.meta,
              }))}
              favorites={[...favSet]}
              racelistUrl={official?.racelist}
            />
          )}
        </section>

        {/* 直前情報。結果が出る前だけ意味がある */}
        {entrants.length > 0 && !eventResult && event.status !== 'cancelled' && (
          <BeforeInfoPanel eventId={event.id} officialUrl={official?.beforeinfo} />
        )}

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
            officialOddsUrl={official?.odds}
            featureCashback={
              feature
                ? { rate: feature.cashbackRate, max: feature.cashbackMax, used: featureUsed }
                : undefined
            }
            tournaments={joinable.map((t) => ({
              id: t.id,
              name: t.name,
              points: t.my_points,
            }))}
          />
        )}
      </main>

      <TabBar />
    </>
  );
}

/** まだ締切前かどうか（大会の財布を出すかの判定用） */
function isOpenLater(event: any): boolean {
  return event.status === 'scheduled' && new Date(event.deadline_at).getTime() > Date.now();
}
