/**
 * 公式サイトのオッズページの解析。
 *
 * 【なぜここに置くか】
 *   オッズは「誰かがそのレースを開いたとき」に取りに行くので、
 *   ingest ワーカーではなく Web 側から呼ばれる。
 *   ただし買い目の正規化ルールと必ず一致させる必要があるため、
 *   normalizeSelection と同じパッケージに置いて共有している。
 *
 * 【解析方針】
 *   公式サイトのオッズ表は賭け式ごとにレイアウトが違う。
 *   実際のページ（2026-08-01 びわこ12R）を見て確認した構造に基づいている。
 *
 *   - 3連単   : 6列(1着ごと)×20行。相手艇番は rowspan で省略されるため、
 *               数値の並び順から買い目を復元する
 *   - 2連単   : 6列。各セルに「相手艇番, オッズ」が明示されている
 *   - 2連複   : 2連単と同じ形（下三角なので空セルあり）
 *   - ※拡連複（ワイド）はこのサイトでは扱わない
 *   - 単勝/複勝: 艇番・選手名・オッズの単純な表
 *
 *   HTMLのクラス名には依存せず、セルの並びと中身だけで解釈している。
 */

import { UNORDERED_SEP, ORDERED_SEP } from './betTypes.ts';
import { compareLane } from './selection.ts';

/** 買い目 → オッズ倍率 */
export type OddsMap = Record<string, number>;

/** 表の1行を「セルの文字列の配列」にしたもの */
export type Row = string[];

const LANES = ['1', '2', '3', '4', '5', '6'];

/**
 * オッズに見えるセルかどうか。
 *
 * 公式サイトは 1000倍を超えるオッズを「1587」のように小数点なしで表示する。
 * 以前は「小数点があること」を条件にしていたため、この高オッズのセルを
 * 見落として行がずれ、表全体の対応が崩れていた。
 * 艇番（1〜6）と区別できればよいので、10以上の整数もオッズとして扱う。
 */
const isOdds = (s: string) => /^\d+(\.\d+)?$/.test(s) && (s.includes('.') || Number(s) >= 10);
const isLane = (s: string) => /^[1-6]$/.test(s);

/**
 * 3連単。
 *
 * 表は1着ごとの6列に分かれ、各列は20行。
 * 行rにおける各列の値の並びは、次の順序で固定されている。
 *
 *   2着を昇順（1着の艇を除く）→ その中で3着を昇順（1着・2着の艇を除く）
 *
 * 実データで検証済み:
 *   1行目 = 11.7, 29.4, 72.8, ... → 1-2-3, 2-1-3, 3-1-2, ...
 *   5行目 = 23.4, 72.9, ...       → 1-3-2, 2-3-1, ...
 */
export function parseTrifectaOdds(rows: Row[]): OddsMap {
  // 各行から「小数に見えるセル」だけを順番に取り出す。
  // 相手艇番は整数なので混ざらない。
  const oddsRows = rows
    .map((cells) => cells.filter(isOdds))
    .filter((v) => v.length === LANES.length);

  const out: OddsMap = {};

  LANES.forEach((first, col) => {
    const combos = trifectaOrder(first);
    combos.forEach(([second, third], row) => {
      const value = oddsRows[row]?.[col];
      if (value === undefined) return;
      out[[first, second, third].join(ORDERED_SEP)] = Number(value);
    });
  });

  return out;
}

/** 1着を固定したときの (2着, 3着) の並び順 */
function trifectaOrder(first: string): [string, string][] {
  const out: [string, string][] = [];
  for (const second of LANES) {
    if (second === first) continue;
    for (const third of LANES) {
      if (third === first || third === second) continue;
      out.push([second, third]);
    }
  }
  return out; // 5 × 4 = 20 通り
}

/**
 * 3連複。
 *
 * 6列に分かれ、列cは「その組で最も小さい艇番 = c+1」に対応する。
 * 下三角なので列ごとに行数が違う（10, 6, 3, 1, 0, 0 で合計20通り）。
 *
 *   列0（軸=1）は表の0行目から、列1（軸=2）は4行目から、
 *   列2（軸=3）は7行目から、列3（軸=4）は9行目から始まる。
 *
 * この「開始位置のズレ」は、列0の並びの中で (c+2, c+3) が何番目に来るかで
 * 決まるので、ハードコードせずに計算で求めている。
 *
 * ある行に小数がk個あれば、それは左からk列分だという性質を使う。
 * 下三角なので必ず左詰めで埋まるため、これが成り立つ。
 *
 * 実データで検証済み:
 *   1行目 = 7.1                    → 1=2=3
 *   5行目 = 13.0, 43.8             → 1=3=4, 2=3=4
 *   10行目 = 15.9, 33.8, 65.0, 44.8 → 1=5=6, 2=5=6, 3=5=6, 4=5=6
 */
export function parseTrioOdds(rows: Row[]): OddsMap {
  const oddsRows = rows
    .map((cells) => cells.filter(isOdds))
    .filter((v) => v.length > 0 && v.length <= 4);

  const out: OddsMap = {};

  // 列ごとの組み合わせと、表の何行目から始まるか
  const columns = [0, 1, 2, 3].map((c) => trioOrder(String(c + 1)));
  const base = columns[0]!;
  const offsets = columns.map((combos) => {
    const first = combos[0];
    if (!first) return -1;
    return base.findIndex((p) => p[0] === first[0] && p[1] === first[1]);
  });

  oddsRows.forEach((values, row) => {
    values.forEach((value, col) => {
      const combos = columns[col];
      const offset = offsets[col];
      if (!combos || offset === undefined || offset < 0) return;

      const combo = combos[row - offset];
      if (!combo) return;

      const axis = String(col + 1);
      out[[axis, combo[0], combo[1]].join(UNORDERED_SEP)] = Number(value);
    });
  });

  return out;
}

/** 最小艇番を固定したときの、残り2艇の並び順（どちらも昇順） */
function trioOrder(axis: string): [string, string][] {
  const out: [string, string][] = [];
  const a = Number(axis);
  for (let b = a + 1; b <= 6; b++) {
    for (let c = b + 1; c <= 6; c++) {
      out.push([String(b), String(c)]);
    }
  }
  return out;
}

/**
 * 2連単 / 2連複。
 *
 * 6列で、各列が「軸となる艇番（列の位置で決まる）」に対応する。
 * セルは (相手艇番, オッズ) の2つ1組で並ぶ。
 * 2連複は下三角なので、空欄の列がある。
 *
 * 相手艇番が明示されているので、位置ではなくその値を使う。
 * こちらのほうがレイアウト変更に強い。
 */
export function parsePairOdds(rows: Row[], ordered: boolean): OddsMap {
  const out: OddsMap = {};
  const sep = ordered ? ORDERED_SEP : UNORDERED_SEP;

  for (const cells of rows) {
    // ヘッダ行（艇番と選手名が並ぶ行）は、小数セルがないので自然に弾かれる
    for (let col = 0; col < LANES.length; col++) {
      const partner = cells[col * 2];
      const value = cells[col * 2 + 1];
      if (!partner || !value) continue;
      if (!isLane(partner) || !isOdds(value)) continue;

      const axis = LANES[col]!;
      if (partner === axis) continue;

      const pair = ordered ? [axis, partner] : [axis, partner].sort(compareLane);
      out[pair.join(sep)] = Number(value);
    }
  }

  return out;
}

/**
 * 単勝。
 * 「艇番 | 選手名 | オッズ」の単純な表。
 */
export function parseWinOdds(rows: Row[]): OddsMap {
  const out: OddsMap = {};
  for (const cells of rows) {
    const lane = cells.find(isLane);
    const value = cells.find(isOdds);
    if (lane && value && !(lane in out)) out[lane] = Number(value);
  }
  return out;
}

/**
 * 複勝。
 * オッズが "1.3-2.3" のような範囲で表示される。
 * 低いほうを採用する（実際の払戻も下限側になることが多く、
 * 期待値を過大に見せないため）。
 */
export function parsePlaceOdds(rows: Row[]): OddsMap {
  const out: OddsMap = {};
  for (const cells of rows) {
    const lane = cells.find(isLane);
    if (!lane || lane in out) continue;

    // 「1.3-2.3」のような範囲表記。区切りが半角/全角どちらでも拾う。
    const range = cells.find((c) => /^\d+(\.\d+)?\s*[-〜~～]\s*\d+(\.\d+)?$/.test(c));
    if (range) {
      const low = Number(range.split(/[-〜~～]/)[0]!.trim());
      if (Number.isFinite(low)) out[lane] = low;
      continue;
    }

    // 範囲ではなく単独の数値で出ているレイアウトにも備える
    const single = cells.find(isOdds);
    if (single) out[lane] = Number(single);
  }
  return out;
}

/** 賭け式コード → オッズページのパス */
export const ODDS_PAGE: Record<string, string> = {
  trifecta: 'odds3t',
  trio: 'odds3f',
  exacta: 'odds2tf',
  quinella: 'odds2tf',
  win: 'oddstf',
  place: 'oddstf',
};

/**
 * オッズ倍率から、賭けたときの払戻見込みを求める。
 * 実際の払戻は確定オッズで計算されるので、あくまで目安。
 */
export function estimatePayout(stake: number, odds: number): number {
  return Math.floor(stake * odds);
}
