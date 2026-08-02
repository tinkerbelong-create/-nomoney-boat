/**
 * 払戻計算。
 *
 * 実際の舟券と同じく「100円（=100pt）あたりの払戻金」で計算する。
 * 例: 3連単 1-2-5 の払戻金が ¥2,380 で 1,000pt 賭けていたら
 *     floor(1000 / 100 * 2380) = 23,800pt。
 *
 * 賭け式による分岐はここに一切ない。
 * 「当たった買い目と、その100あたり払戻」さえ決まれば計算は共通。
 */

/** 賭ける単位。実際の舟券が100円単位なのに合わせている。 */
export const STAKE_UNIT = 100;
export const MIN_STAKE = 100;
export const MAX_STAKE = 999_900;

export interface WinningEntry {
  /** 正規化済みの当たり買い目。複勝のように当たりが複数ある賭け式もある。 */
  selection: string;
  /** 100pt あたりの払戻pt */
  payoutPer100: number;
  /** 人気（公式データがあるときのみ） */
  popularity?: number;
}

/** 1点分の払戻を求める。外れなら 0。 */
export function calcPayout(
  selection: string,
  stake: number,
  winners: WinningEntry[],
): number {
  const hit = winners.find((w) => w.selection === selection);
  if (!hit) return 0;
  return Math.floor((stake / STAKE_UNIT) * hit.payoutPer100);
}

/** 賭け点数として妥当かどうか */
export function validateStake(stake: number): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(stake)) return { ok: false, reason: '点数は整数で入力してください' };
  if (stake < MIN_STAKE) return { ok: false, reason: `最低${MIN_STAKE}ptから賭けられます` };
  if (stake > MAX_STAKE) return { ok: false, reason: `1点あたり${MAX_STAKE.toLocaleString()}ptまでです` };
  if (stake % STAKE_UNIT !== 0) return { ok: false, reason: `${STAKE_UNIT}pt単位で入力してください` };
  return { ok: true };
}

/**
 * パリミュチュエル方式の払戻率を求める。
 *
 * 今回のボートレースMVPでは使わない（公式の確定払戻金を使うため）が、
 * 将来 eSports や自作の企画レースを同じ仕組みに載せるときにここを使う。
 * 胴元がいないので控除率は0%、つまりプール全額を的中者で分ける。
 */
export function calcParimutuel(
  bets: { selection: string; stake: number }[],
  winningSelections: string[],
): WinningEntry[] {
  const pool = bets.reduce((s, b) => s + b.stake, 0);
  const winSet = new Set(winningSelections);
  const winningStake = bets
    .filter((b) => winSet.has(b.selection))
    .reduce((s, b) => s + b.stake, 0);

  // 的中者がいない場合は払戻を作らない（呼び出し側で全額返還にする）
  if (pool === 0 || winningStake === 0) return [];

  const payoutPer100 = Math.floor((pool / winningStake) * STAKE_UNIT);
  return winningSelections.map((selection) => ({ selection, payoutPer100 }));
}

/** 収支・回収率・的中率 */
export interface Performance {
  betCount: number;
  hitCount: number;
  totalStake: number;
  totalPayout: number;
  profit: number;
  /** 回収率(%)。賭けがなければ null */
  roiPct: number | null;
  /** 的中率(%)。賭けがなければ null */
  hitPct: number | null;
}

/**
 * 成績の集計。
 * 返還（refunded）は「賭けていない」扱いにして分母から除く。実際の慣習に合わせている。
 */
export function summarize(
  bets: { stake: number; payout: number; status: 'placed' | 'won' | 'lost' | 'refunded' }[],
): Performance {
  const settled = bets.filter((b) => b.status === 'won' || b.status === 'lost');
  const betCount = settled.length;
  const hitCount = settled.filter((b) => b.status === 'won').length;
  const totalStake = settled.reduce((s, b) => s + b.stake, 0);
  const totalPayout = settled.reduce((s, b) => s + b.payout, 0);

  return {
    betCount,
    hitCount,
    totalStake,
    totalPayout,
    profit: totalPayout - totalStake,
    roiPct: totalStake > 0 ? round1((totalPayout / totalStake) * 100) : null,
    hitPct: betCount > 0 ? round1((hitCount / betCount) * 100) : null,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
