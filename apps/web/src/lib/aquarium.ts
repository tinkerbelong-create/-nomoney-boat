/**
 * 水槽まわりの型と定数。
 *
 * 【ここにサーバー専用のものを置かないこと】
 * Tank.tsx はクライアントコンポーネントで、このファイルから
 * 定数（TANK_CAPACITY など）を読む。ここで next/headers に触る
 * supabase をimportすると、それがクライアントバンドルに引きずり込まれて
 * ビルドが落ちる。実際に一度やった。
 * DBを叩く関数は lib/queries.ts のほうに置いてある。
 *
 * 生き物はポイントで買えないし売れない。的中の記録でしかない。
 * だから書き込みの関数はどこにも無い。付与は精算のときにDB側で行う。
 */

export interface CreatureRow {
  code: string;
  name: string;
  star: number;
  category: string;
  family: string;
  color_a: string;
  color_b: string;
  move: 'swim' | 'float' | 'crawl' | 'fix';
  water: string | null;
  area: string | null;
  night: boolean;
  venue_code: string | null;
  description: string;
  /** 0 なら未取得 */
  count: number;
  first_at: string | null;
  /** はじめて取ったときのレースの記録 */
  meta: CreatureMeta;
}

export interface CreatureMeta {
  eventId?: string;
  venue?: string;
  raceNo?: number;
  deadline?: string;
  raceGrade?: string | null;
  betType?: string;
  selection?: string;
  stake?: number;
  payout?: number;
  ratio?: number;
}

export interface TankRow {
  code: string;
  name: string;
  star: number;
  category: string;
  family: string;
  color_a: string;
  color_b: string;
  move: 'swim' | 'float' | 'crawl' | 'fix';
  count: number;
  meta: CreatureMeta;
}

/** 1つの水槽に入る数。DB側の tank_capacity() と合わせること */
export const TANK_CAPACITY = 30;

/** ★ごとの呼び名。数字だけだと初心者に伝わらない */
export const STAR_LABEL: Record<number, string> = {
  1: 'ありふれた',
  2: 'ありふれた',
  3: 'よく見る',
  4: 'めずらしい',
  5: 'めずらしい',
  6: 'かなりレア',
  7: 'かなりレア',
  8: '超レア',
  9: '伝説級',
  10: '伝説',
};

/** 出現条件を日本語1行にする */
export function whereText(c: Pick<CreatureRow, 'water' | 'area' | 'night' | 'venue_code'>,
                          venueName?: string): string | null {
  if (c.venue_code) return `${venueName ?? c.venue_code} の主`;
  if (c.water) return `${c.water}の場だけ`;
  if (c.area) return `${c.area}の場だけ`;
  if (c.night) return '夜のレースだけ';
  return null;
}

/** 賭け式コード → 表示名 */
export const BET_LABEL: Record<string, string> = {
  trifecta: '3連単',
  trio: '3連複',
  exacta: '2連単',
  quinella: '2連複',
  win: '単勝',
  place: '複勝',
};
