/**
 * 賭け式の定義。
 *
 * 実際のボートレースの舟券7種類をそのまま再現している。
 * 賭け式を TypeScript の union 型で固定していないのは、将来ほかの競技
 * （賭け式の集合が違う）を足すときにここを書き換えたくないため。
 * 実行時は DB の bet_types テーブルが正で、ここはその型定義と
 * ボートレース用の既定値を持つ。
 */

export type SelectionKind =
  | 'single'           // 1つ選ぶ            例: 単勝 "1"
  | 'combo_ordered'    // 順序あり複数選ぶ    例: 3連単 "1-2-5"
  | 'combo_unordered'  // 順序なし複数選ぶ    例: 3連複 "1=2=5"
  | 'enumerated';      // 固定の選択肢から選ぶ（将来用）

export interface BetType {
  sportCode: string;
  code: string;
  name: string;
  shortName: string;
  selectionKind: SelectionKind;
  pickCount: number;
  sortOrder: number;
  /** 画面に出す一行説明 */
  description: string;
}

/** 順序あり組み合わせの区切り文字（1着-2着-3着） */
export const ORDERED_SEP = '-';
/** 順序なし組み合わせの区切り文字 */
export const UNORDERED_SEP = '=';

/** ボートレースの艇番。常に1〜6の6艇。 */
export const BOATRACE_LANES = ['1', '2', '3', '4', '5', '6'] as const;

export const BOATRACE_BET_TYPES: BetType[] = [
  {
    sportCode: 'boatrace',
    code: 'trifecta',
    name: '3連単',
    shortName: '3連単',
    selectionKind: 'combo_ordered',
    pickCount: 3,
    sortOrder: 1,
    description: '1着・2着・3着を着順どおりに当てる',
  },
  {
    sportCode: 'boatrace',
    code: 'trio',
    name: '3連複',
    shortName: '3連複',
    selectionKind: 'combo_unordered',
    pickCount: 3,
    sortOrder: 2,
    description: '3着までに入る3艇を順不同で当てる',
  },
  {
    sportCode: 'boatrace',
    code: 'exacta',
    name: '2連単',
    shortName: '2連単',
    selectionKind: 'combo_ordered',
    pickCount: 2,
    sortOrder: 3,
    description: '1着・2着を着順どおりに当てる',
  },
  {
    sportCode: 'boatrace',
    code: 'quinella',
    name: '2連複',
    shortName: '2連複',
    selectionKind: 'combo_unordered',
    pickCount: 2,
    sortOrder: 4,
    description: '2着までに入る2艇を順不同で当てる',
  },
  {
    sportCode: 'boatrace',
    code: 'win',
    name: '単勝',
    shortName: '単勝',
    selectionKind: 'single',
    pickCount: 1,
    sortOrder: 5,
    description: '1着の艇を当てる',
  },
  {
    sportCode: 'boatrace',
    code: 'place',
    name: '複勝',
    shortName: '複勝',
    selectionKind: 'single',
    pickCount: 1,
    sortOrder: 6,
    description: '2着までに入る艇を当てる',
  },
];

// 拡連複（ワイド）は実際の舟券には存在するが、このサイトでは扱わない。
// 賭け式は bet_types の行として持っているので、ここに定義を足して
// seed.sql に1行 INSERT すればいつでも復活させられる。

const BY_CODE = new Map(BOATRACE_BET_TYPES.map((b) => [b.code, b]));

export function getBoatraceBetType(code: string): BetType {
  const bt = BY_CODE.get(code);
  if (!bt) throw new Error(`unknown boatrace bet type: ${code}`);
  return bt;
}

/** その賭け式で買える全通りの点数（表示用） */
export function combinationCount(betType: BetType, laneCount = 6): number {
  const { selectionKind, pickCount } = betType;
  if (selectionKind === 'single') return laneCount;
  if (selectionKind === 'combo_ordered') {
    let n = 1;
    for (let i = 0; i < pickCount; i++) n *= laneCount - i;
    return n;
  }
  if (selectionKind === 'combo_unordered') {
    let num = 1;
    let den = 1;
    for (let i = 0; i < pickCount; i++) {
      num *= laneCount - i;
      den *= i + 1;
    }
    return num / den;
  }
  return 0;
}
