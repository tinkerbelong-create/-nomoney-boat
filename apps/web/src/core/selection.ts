/**
 * 買い目（selection）の正規化と検証。
 *
 * ここが本システムで最も壊れてはいけない部分。
 * 的中判定は「投票の selection 文字列」と「結果の winning_selection 文字列」の
 * 完全一致で行うため、両者が同じルールで正規化されている必要がある。
 * Web と ingest ワーカーの両方がこのモジュールを共有する。
 *
 * 順不同の賭け式（3連複・2連複）は必ず昇順にソートする。
 * これを忘れると "1=2" と "2=1" が別物になり的中しない。
 */

import {
  type BetType,
  type SelectionKind,
  ORDERED_SEP,
  UNORDERED_SEP,
} from './betTypes.ts';

export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectionError';
  }
}

/** 賭け式ごとの区切り文字 */
export function separatorFor(kind: SelectionKind): string {
  return kind === 'combo_unordered' ? UNORDERED_SEP : ORDERED_SEP;
}

/**
 * 選んだ艇番の配列を、DBに保存する正規形の文字列に変換する。
 *
 *   normalizeSelection(trifecta, ['1','2','5'])  -> '1-2-5'
 *   normalizeSelection(trio,     ['5','2','1'])  -> '1=2=5'   （昇順ソート）
 *   normalizeSelection(win,      ['3'])          -> '3'
 */
export function normalizeSelection(betType: BetType, picks: string[]): string {
  const cleaned = picks.map((p) => String(p).trim()).filter((p) => p.length > 0);

  if (cleaned.length !== betType.pickCount) {
    throw new SelectionError(
      `${betType.name}は${betType.pickCount}つ選んでください（${cleaned.length}つ選択されています）`,
    );
  }

  if (new Set(cleaned).size !== cleaned.length) {
    throw new SelectionError('同じ艇を重複して選べません');
  }

  switch (betType.selectionKind) {
    case 'single':
    case 'enumerated':
      return cleaned[0]!;
    case 'combo_ordered':
      return cleaned.join(ORDERED_SEP);
    case 'combo_unordered':
      return [...cleaned].sort(compareLane).join(UNORDERED_SEP);
  }
}

/**
 * 艇番の比較。数字なら数値順、そうでなければ辞書順。
 * 将来の競技で '10' や 'T1' のような値が来ても壊れないようにしてある。
 */
export function compareLane(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 正規形の文字列を配列に戻す（表示用） */
export function parseSelection(betType: BetType, selection: string): string[] {
  const sep = separatorFor(betType.selectionKind);
  if (betType.selectionKind === 'single' || betType.selectionKind === 'enumerated') {
    return [selection];
  }
  return selection.split(sep);
}

/** 選んだ艇番が、その本命に実在するかを検証する */
export function assertValidLanes(picks: string[], validLanes: readonly string[]): void {
  for (const p of picks) {
    if (!validLanes.includes(p)) {
      throw new SelectionError(`${p} は選べません`);
    }
  }
}

/**
 * 「流し買い」「ボックス買い」の展開。
 *
 * 実際の投票サイトと同じ感覚で複数点をまとめて買えるようにするためのもの。
 * 展開結果はそれぞれ独立した1点として bets に入る。
 */

/** ボックス: 選んだ艇の全組み合わせ */
export function expandBox(betType: BetType, picks: string[]): string[] {
  const unique = [...new Set(picks)];
  if (unique.length < betType.pickCount) {
    throw new SelectionError(`ボックスは${betType.pickCount}艇以上選んでください`);
  }

  const combos =
    betType.selectionKind === 'combo_ordered'
      ? permutations(unique, betType.pickCount)
      : combinations(unique, betType.pickCount);

  const out = combos.map((c) => normalizeSelection(betType, c));
  return dedupe(out);
}

/**
 * フォーメーション: 着位ごとに候補を指定する。
 * 例: 1着=[1], 2着=[2,3], 3着=[4,5] → 1-2-4, 1-2-5, 1-3-4, 1-3-5
 * 順不同の賭け式では単純な直積のあと正規化＋重複除去でボックス相当になる。
 */
export function expandFormation(betType: BetType, groups: string[][]): string[] {
  if (groups.length !== betType.pickCount) {
    throw new SelectionError(`${betType.pickCount}つの着位を指定してください`);
  }

  const out: string[] = [];
  const walk = (depth: number, acc: string[]) => {
    if (depth === groups.length) {
      if (new Set(acc).size !== acc.length) return; // 同じ艇の重複は無効
      out.push(normalizeSelection(betType, acc));
      return;
    }
    for (const g of groups[depth]!) walk(depth + 1, [...acc, g]);
  };
  walk(0, []);

  if (out.length === 0) {
    throw new SelectionError('有効な組み合わせがありません');
  }
  return dedupe(out);
}

/**
 * ながし: 軸を固定し、相手を指定する。
 * 例: 3連単 1着ながし 軸=1 相手=[2,3,4] → 1-2-3, 1-2-4, 1-3-2, ...
 */
export function expandNagashi(
  betType: BetType,
  axis: string,
  axisPosition: number,
  opponents: string[],
): string[] {
  if (betType.selectionKind === 'single') {
    throw new SelectionError('この賭け式にながしはありません');
  }
  const others = opponents.filter((o) => o !== axis);
  const groups: string[][] = [];
  for (let i = 0; i < betType.pickCount; i++) {
    groups.push(i === axisPosition ? [axis] : others);
  }
  return expandFormation(betType, groups);
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

function combinations<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [head, ...rest] = xs;
  return [
    ...combinations(rest, k - 1).map((c) => [head!, ...c]),
    ...combinations(rest, k),
  ];
}

function permutations<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest, k - 1)) out.push([x, ...p]);
  });
  return out;
}
