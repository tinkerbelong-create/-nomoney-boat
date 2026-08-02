/**
 * 実データによる検証。
 *
 * 固定値は 2026-07-31 びわこ12R（第31回オーシャンカップ）の
 * 公式結果ページから取った実際の払戻金を使っている。
 *   着順 1着=1号艇 / 2着=2号艇 / 3着=5号艇
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  getBoatraceBetType,
  combinationCount,
  BOATRACE_BET_TYPES,
  BOATRACE_LANES,
} from './betTypes.ts';
import {
  normalizeSelection,
  parseSelection,
  expandBox,
  expandFormation,
  expandNagashi,
  assertValidLanes,
  SelectionError,
} from './selection.ts';
import {
  calcPayout,
  calcParimutuel,
  validateStake,
  summarize,
  type WinningEntry,
} from './payout.ts';
import { boatraceEventKey, parseBoatraceEventKey, venueName } from './venues.ts';

/** びわこ12R の確定払戻金（100円あたり） */
const BIWAKO_12R: Record<string, WinningEntry[]> = {
  trifecta: [{ selection: '1-2-5', payoutPer100: 2380, popularity: 9 }],
  trio:     [{ selection: '1=2=5', payoutPer100: 1260, popularity: 5 }],
  exacta:   [{ selection: '1-2',   payoutPer100: 340,  popularity: 2 }],
  quinella: [{ selection: '1=2',   payoutPer100: 330,  popularity: 2 }],
  win:   [{ selection: '1', payoutPer100: 120 }],
  place: [
    { selection: '1', payoutPer100: 100 },
    { selection: '2', payoutPer100: 180 },
  ],
};

// ---------------------------------------------------------------------

describe('買い目の正規化', () => {
  test('3連単は選んだ順序を保つ', () => {
    const bt = getBoatraceBetType('trifecta');
    assert.equal(normalizeSelection(bt, ['1', '2', '5']), '1-2-5');
    assert.equal(normalizeSelection(bt, ['5', '2', '1']), '5-2-1');
  });

  test('3連複は昇順にソートされる', () => {
    const bt = getBoatraceBetType('trio');
    assert.equal(normalizeSelection(bt, ['5', '2', '1']), '1=2=5');
    assert.equal(normalizeSelection(bt, ['1', '5', '2']), '1=2=5');
    assert.equal(normalizeSelection(bt, ['2', '1', '5']), '1=2=5');
  });

  test('2連複も昇順にソートされる', () => {
    assert.equal(normalizeSelection(getBoatraceBetType('quinella'), ['2', '1']), '1=2');
    assert.equal(normalizeSelection(getBoatraceBetType('quinella'), ['5', '2']), '2=5');
  });

  test('単勝・複勝はそのまま', () => {
    assert.equal(normalizeSelection(getBoatraceBetType('win'), ['3']), '3');
    assert.equal(normalizeSelection(getBoatraceBetType('place'), ['6']), '6');
  });

  test('点数が足りないとエラー', () => {
    const bt = getBoatraceBetType('trifecta');
    assert.throws(() => normalizeSelection(bt, ['1', '2']), SelectionError);
  });

  test('同じ艇の重複はエラー', () => {
    const bt = getBoatraceBetType('trifecta');
    assert.throws(() => normalizeSelection(bt, ['1', '1', '2']), SelectionError);
  });

  test('存在しない艇番は弾く', () => {
    assert.throws(() => assertValidLanes(['7'], BOATRACE_LANES), SelectionError);
    assert.doesNotThrow(() => assertValidLanes(['1', '6'], BOATRACE_LANES));
  });

  test('正規形から配列に戻せる', () => {
    assert.deepEqual(parseSelection(getBoatraceBetType('trifecta'), '1-2-5'), ['1', '2', '5']);
    assert.deepEqual(parseSelection(getBoatraceBetType('trio'), '1=2=5'), ['1', '2', '5']);
    assert.deepEqual(parseSelection(getBoatraceBetType('win'), '3'), ['3']);
  });
});

// ---------------------------------------------------------------------

describe('払戻計算（びわこ12R 実データ）', () => {
  test('3連単 1-2-5 に1,000pt → 23,800pt', () => {
    assert.equal(calcPayout('1-2-5', 1000, BIWAKO_12R.trifecta!), 23800);
  });

  test('3連複は逆順で買っていても的中する', () => {
    const bt = getBoatraceBetType('trio');
    const sel = normalizeSelection(bt, ['5', '2', '1']); // わざと逆順で買う
    assert.equal(calcPayout(sel, 1000, BIWAKO_12R.trio!), 12600);
  });

  test('2連単 1-2 に500pt → 1,700pt', () => {
    assert.equal(calcPayout('1-2', 500, BIWAKO_12R.exacta!), 1700);
  });

  test('2連複 1=2 に500pt → 1,650pt', () => {
    const sel = normalizeSelection(getBoatraceBetType('quinella'), ['2', '1']);
    assert.equal(calcPayout(sel, 500, BIWAKO_12R.quinella!), 1650);
  });

  test('単勝は1号艇のみ的中', () => {
    assert.equal(calcPayout('1', 1000, BIWAKO_12R.win!), 1200);
    assert.equal(calcPayout('2', 1000, BIWAKO_12R.win!), 0);
  });

  test('複勝は2着までが的中', () => {
    assert.equal(calcPayout('1', 1000, BIWAKO_12R.place!), 1000);
    assert.equal(calcPayout('2', 1000, BIWAKO_12R.place!), 1800);
    assert.equal(calcPayout('5', 1000, BIWAKO_12R.place!), 0); // 3着は複勝の対象外
  });

  test('外れは0pt', () => {
    assert.equal(calcPayout('1-2-6', 10000, BIWAKO_12R.trifecta!), 0);
  });

  test('端数は切り捨て', () => {
    // 100pt単位を強制しているので通常は起きないが、念のため
    assert.equal(calcPayout('1', 150, [{ selection: '1', payoutPer100: 105 }]), 157);
  });
});

// ---------------------------------------------------------------------

describe('賭け点数の検証', () => {
  test('100pt単位のみ受け付ける', () => {
    assert.equal(validateStake(100).ok, true);
    assert.equal(validateStake(1000).ok, true);
    assert.equal(validateStake(150).ok, false);
    assert.equal(validateStake(50).ok, false);
    assert.equal(validateStake(0).ok, false);
    assert.equal(validateStake(-100).ok, false);
    assert.equal(validateStake(1.5).ok, false);
  });
});

// ---------------------------------------------------------------------

describe('まとめ買いの展開', () => {
  test('3連単ボックス 1,2,3 は6点', () => {
    const out = expandBox(getBoatraceBetType('trifecta'), ['1', '2', '3']);
    assert.equal(out.length, 6);
    assert.deepEqual(
      [...out].sort(),
      ['1-2-3', '1-3-2', '2-1-3', '2-3-1', '3-1-2', '3-2-1'],
    );
  });

  test('3連複ボックス 1,2,3,4 は4点', () => {
    const out = expandBox(getBoatraceBetType('trio'), ['1', '2', '3', '4']);
    assert.equal(out.length, 4);
    assert.deepEqual([...out].sort(), ['1=2=3', '1=2=4', '1=3=4', '2=3=4']);
  });

  test('3連単フォーメーション 1着=1 / 2着=2,3 / 3着=4,5 は4点', () => {
    const out = expandFormation(getBoatraceBetType('trifecta'), [['1'], ['2', '3'], ['4', '5']]);
    assert.deepEqual([...out].sort(), ['1-2-4', '1-2-5', '1-3-4', '1-3-5']);
  });

  test('フォーメーションで艇が重複する組み合わせは除外される', () => {
    const out = expandFormation(getBoatraceBetType('exacta'), [['1', '2'], ['1', '2']]);
    assert.deepEqual([...out].sort(), ['1-2', '2-1']);
  });

  test('3連単 1着ながし 軸=1 相手=2,3,4 は6点', () => {
    const out = expandNagashi(getBoatraceBetType('trifecta'), '1', 0, ['2', '3', '4']);
    assert.equal(out.length, 6);
    assert.ok(out.every((s) => s.startsWith('1-')));
  });

  test('2連複ながしは重複が畳まれる', () => {
    const out = expandNagashi(getBoatraceBetType('quinella'), '1', 0, ['2', '3']);
    assert.deepEqual([...out].sort(), ['1=2', '1=3']);
  });
});

// ---------------------------------------------------------------------

describe('全通りの点数', () => {
  test('6艇での組み合わせ数が実際の舟券と一致する', () => {
    assert.equal(combinationCount(getBoatraceBetType('trifecta')), 120);
    assert.equal(combinationCount(getBoatraceBetType('trio')), 20);
    assert.equal(combinationCount(getBoatraceBetType('exacta')), 30);
    assert.equal(combinationCount(getBoatraceBetType('quinella')), 15);
    assert.equal(combinationCount(getBoatraceBetType('win')), 6);
    assert.equal(combinationCount(getBoatraceBetType('place')), 6);
  });

  test('扱う賭け式は6種類（拡連複を除く）', () => {
    assert.equal(BOATRACE_BET_TYPES.length, 6);
    assert.ok(!BOATRACE_BET_TYPES.some((b) => b.code === 'wide'));
    assert.throws(() => getBoatraceBetType('wide'));
  });
});

// ---------------------------------------------------------------------

describe('成績の集計', () => {
  test('収支・回収率・的中率', () => {
    const perf = summarize([
      { stake: 1000, payout: 23800, status: 'won' },
      { stake: 500,  payout: 0,     status: 'lost' },
      { stake: 2000, payout: 0,     status: 'refunded' }, // 返還は分母から除く
      { stake: 300,  payout: 0,     status: 'placed' },   // 未確定も除く
    ]);
    assert.equal(perf.betCount, 2);
    assert.equal(perf.hitCount, 1);
    assert.equal(perf.totalStake, 1500);
    assert.equal(perf.totalPayout, 23800);
    assert.equal(perf.profit, 22300);
    assert.equal(perf.hitPct, 50);
    assert.equal(perf.roiPct, 1586.7);
  });

  test('賭けがゼロなら率は null', () => {
    const perf = summarize([]);
    assert.equal(perf.roiPct, null);
    assert.equal(perf.hitPct, null);
  });
});

// ---------------------------------------------------------------------

describe('パリミュチュエル（将来の拡張用）', () => {
  test('プールが的中者で山分けされ、ポイント総量が保存される', () => {
    const bets = [
      { selection: 'A', stake: 3000 },
      { selection: 'A', stake: 1000 },
      { selection: 'B', stake: 5000 },
      { selection: 'B', stake: 2000 },
      { selection: 'B', stake: 1000 },
    ];
    const winners = calcParimutuel(bets, ['A']);
    assert.equal(winners[0]!.payoutPer100, 300);

    const paid = bets.reduce((s, b) => s + calcPayout(b.selection, b.stake, winners), 0);
    const pool = bets.reduce((s, b) => s + b.stake, 0);
    assert.equal(paid, pool); // 端数が出ないケース
  });

  test('的中者がいなければ払戻は作られない（呼び出し側で全額返還）', () => {
    const winners = calcParimutuel([{ selection: 'A', stake: 1000 }], ['B']);
    assert.deepEqual(winners, []);
  });

  test('端数が出ても払出がプールを超えない', () => {
    const bets = [
      { selection: 'A', stake: 700 },
      { selection: 'B', stake: 1000 },
    ];
    const winners = calcParimutuel(bets, ['A']);
    const paid = bets.reduce((s, b) => s + calcPayout(b.selection, b.stake, winners), 0);
    assert.ok(paid <= 1700, `払出${paid}がプール1700を超えている`);
  });
});

// ---------------------------------------------------------------------

describe('イベントキーと会場', () => {
  test('生成とパースが往復する', () => {
    const key = boatraceEventKey('20260801', '11', 12);
    assert.equal(key, 'boatrace:20260801:11:12');
    assert.deepEqual(parseBoatraceEventKey(key), {
      dateYmd: '20260801',
      venueCode: '11',
      raceNo: 12,
    });
  });

  test('場コードから場名が引ける', () => {
    assert.equal(venueName('11'), 'びわこ');
    assert.equal(venueName('01'), '桐生');
    assert.equal(venueName('24'), '大村');
  });
});
