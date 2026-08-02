/**
 * 1レース分の精算。
 *
 * 取り込みワーカー（15分ごと）と、画面の「更新」ボタンの両方から呼ぶ。
 * どちらから呼んでも同じ結果になるよう、何度実行しても安全に作ってある。
 * 台帳の二重計上は point_ledger の部分一意インデックスが最終防衛線。
 *
 * データベースに書き込む権限が要るので、必ず service_role の
 * クライアントを渡すこと。
 */

import { calcPayout, type WinningEntry } from './payout.ts';
import { parseSelection } from './selection.ts';
import { getBoatraceBetType } from './betTypes.ts';
import type { RaceResult } from './raceresult.ts';

/** supabase-js のクライアント。型は緩くしてある（web と ingest で版が違うため）。 */
type Client = any;

export interface SettleSummary {
  won: number;
  lost: number;
  refunded: number;
}

export async function settleEvent(
  supabase: Client,
  eventId: string,
  result: RaceResult,
): Promise<SettleSummary> {
  const total: SettleSummary = { won: 0, lost: 0, refunded: 0 };

  // 結果の表示用データ
  await supabase.from('event_results').upsert({
    event_id: eventId,
    placings: result.placings,
    refunded: result.refunded,
    weather: result.weather,
    decided_by: result.decidedBy ?? null,
    resolved_at: new Date().toISOString(),
  });

  const { data: markets } = await supabase
    .from('markets')
    .select('id, bet_type_code, status')
    .eq('event_id', eventId);

  for (const market of markets ?? []) {
    if (market.status === 'settled' || market.status === 'void') continue;

    const draft = result.markets.find((m) => m.betTypeCode === market.bet_type_code);
    const winners: WinningEntry[] = draft?.payouts ?? [];

    if (winners.length > 0) {
      await supabase.from('market_results').upsert(
        winners.map((w) => ({
          market_id: market.id,
          winning_selection: w.selection,
          payout_per_100: w.payoutPer100,
          popularity: w.popularity ?? null,
        })),
        { onConflict: 'market_id,winning_selection' },
      );
    }

    const s = await settleBetsForMarket(
      supabase,
      market.id,
      market.bet_type_code,
      winners,
      result.refunded,
    );
    total.won += s.won;
    total.lost += s.lost;
    total.refunded += s.refunded;

    await supabase.from('markets').update({ status: 'settled' }).eq('id', market.id);
  }

  await supabase.from('events').update({ status: 'resolved' }).eq('id', eventId);
  return total;
}

/**
 * 1マーケット分の投票を確定する。
 * 返還艇を含む買い目は、当たり外れに関わらず返還として扱う（実際の舟券と同じ）。
 */
async function settleBetsForMarket(
  supabase: Client,
  marketId: string,
  betTypeCode: string,
  winners: WinningEntry[],
  refundedLanes: string[],
): Promise<SettleSummary> {
  const { data: bets } = await supabase
    .from('bets')
    .select('id, user_id, season_code, selection, stake')
    .eq('market_id', marketId)
    .eq('status', 'placed');

  if (!bets || bets.length === 0) return { won: 0, lost: 0, refunded: 0 };

  const betType = getBoatraceBetType(betTypeCode);
  const refundSet = new Set(refundedLanes);

  const won: { id: string; user_id: string; season_code: string; payout: number }[] = [];
  const lost: string[] = [];
  const refunded: { id: string; user_id: string; season_code: string; stake: number }[] = [];

  for (const bet of bets) {
    const lanes = parseSelection(betType, bet.selection);
    if (lanes.some((l) => refundSet.has(l))) {
      refunded.push(bet as any);
      continue;
    }

    const payout = calcPayout(bet.selection, bet.stake, winners);
    if (payout > 0) {
      won.push({ id: bet.id, user_id: bet.user_id, season_code: bet.season_code, payout });
    } else {
      lost.push(bet.id);
    }
  }

  // 台帳が先。ここで失敗しても bets はまだ placed なので再実行で復旧できる。
  if (won.length > 0) {
    const { error } = await supabase.from('point_ledger').upsert(
      won.map((w) => ({
        user_id: w.user_id,
        season_code: w.season_code,
        entry_type: 'payout',
        amount: w.payout,
        ref_type: 'bet',
        ref_id: w.id,
      })),
      { onConflict: 'ref_type,ref_id,entry_type', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  if (refunded.length > 0) {
    const { error } = await supabase.from('point_ledger').upsert(
      refunded.map((r) => ({
        user_id: r.user_id,
        season_code: r.season_code,
        entry_type: 'refund',
        amount: r.stake,
        ref_type: 'bet',
        ref_id: r.id,
        memo: '返還艇を含むため',
      })),
      { onConflict: 'ref_type,ref_id,entry_type', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const now = new Date().toISOString();

  for (const w of won) {
    await supabase
      .from('bets')
      .update({ status: 'won', payout: w.payout, settled_at: now })
      .eq('id', w.id)
      .eq('status', 'placed');
  }

  if (lost.length > 0) {
    await supabase
      .from('bets')
      .update({ status: 'lost', payout: 0, settled_at: now })
      .in('id', lost)
      .eq('status', 'placed');
  }

  if (refunded.length > 0) {
    await supabase
      .from('bets')
      .update({ status: 'refunded', payout: 0, settled_at: now })
      .in(
        'id',
        refunded.map((r) => r.id),
      )
      .eq('status', 'placed');
  }

  return { won: won.length, lost: lost.length, refunded: refunded.length };
}
