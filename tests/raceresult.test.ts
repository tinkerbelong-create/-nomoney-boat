/**
 * 結果ページの解析の検証。
 *
 * 使っているのは 2026-08-02 常滑6R の実際の結果。
 * （3連単 1-6-5 が ¥14,390、拡連複が3行ある典型的なページ）
 *
 * ここが壊れると投票がずっと「結果待ち」のままになり、
 * ポイントが反映されない＝このサイトの根幹が止まる。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseRaceResult } from '../apps/web/src/core/raceresult.ts';

const HTML = `<html><body>
<table>
  <thead><tr><th>着</th><th>枠</th><th>ボートレーサー</th><th>レースタイム</th></tr></thead>
  <tbody>
    <tr><td>１</td><td>1</td><td>5150 坂本 雄紀</td><td>1'51"6</td></tr>
    <tr><td>２</td><td>6</td><td>5222 津田 陸翔</td><td>1'52"9</td></tr>
    <tr><td>３</td><td>5</td><td>5407 中岡 駿</td><td>1'54"6</td></tr>
    <tr><td>４</td><td>2</td><td>5197 中野 仁照</td><td>1'55"0</td></tr>
    <tr><td>５</td><td>4</td><td>5289 佃 來紀</td><td></td></tr>
    <tr><td>６</td><td>3</td><td>5271 杉山 太陽</td><td></td></tr>
  </tbody>
</table>

<table>
  <thead><tr><th>勝式</th><th>組番</th><th>払戻金</th><th>人気</th></tr></thead>
  <tbody>
    <tr><td>3連単</td><td>1-6-5</td><td>¥14,390</td><td>35</td></tr>
    <tr><td>3連複</td><td>1=5=6</td><td>¥4,330</td><td>12</td></tr>
    <tr><td>2連単</td><td>1-6</td><td>¥1,200</td><td>4</td></tr>
    <tr><td>2連複</td><td>1=6</td><td>¥700</td><td>3</td></tr>
    <tr><td>拡連複</td><td>1=6</td><td>¥310</td><td>3</td></tr>
    <tr><td></td><td>1=5</td><td>¥800</td><td>8</td></tr>
    <tr><td></td><td>5=6</td><td>¥850</td><td>11</td></tr>
    <tr><td>単勝</td><td>1</td><td>¥150</td><td></td></tr>
    <tr><td>複勝</td><td>1</td><td>¥100</td><td></td></tr>
    <tr><td></td><td>6</td><td>¥120</td><td></td></tr>
  </tbody>
</table>

<p>気温 35.0℃ 晴 風速 4m 水温 31.0℃ 波高 2cm</p>

<table><tr><th>返還</th></tr><tr><td></td></tr></table>
<table><tr><th>決まり手</th></tr><tr><td>逃げ</td></tr></table>
</body></html>`;

describe('結果ページの解析（常滑6R）', () => {
  const r = parseRaceResult(HTML);

  test('確定として読める', () => {
    assert.ok(r);
    assert.equal(r!.status, 'resolved');
  });

  test('着順が取れる', () => {
    const p = r!.placings;
    assert.equal(p.length, 6);
    assert.deepEqual(
      p.slice(0, 3).map((x) => [x.rank, x.slot]),
      [
        [1, '1'],
        [2, '6'],
        [3, '5'],
      ],
    );
    assert.equal(p[0]!.name, '坂本 雄紀');
  });

  test('3連単の払戻が正しい', () => {
    const m = r!.markets.find((x) => x.betTypeCode === 'trifecta')!;
    assert.equal(m.payouts.length, 1);
    assert.equal(m.payouts[0]!.selection, '1-6-5');
    assert.equal(m.payouts[0]!.payoutPer100, 14390);
    assert.equal(m.payouts[0]!.popularity, 35);
  });

  test('3連複は昇順に正規化される', () => {
    const m = r!.markets.find((x) => x.betTypeCode === 'trio')!;
    assert.equal(m.payouts[0]!.selection, '1=5=6');
    assert.equal(m.payouts[0]!.payoutPer100, 4330);
  });

  test('拡連複の行を2連複の当たり目に混ぜない', () => {
    // ここが混ざると、外れの買い目が的中になってしまう
    const m = r!.markets.find((x) => x.betTypeCode === 'quinella')!;
    assert.deepEqual(
      m.payouts.map((p) => p.selection),
      ['1=6'],
    );
    assert.equal(m.payouts[0]!.payoutPer100, 700);
  });

  test('複勝は当たりが2つ', () => {
    const m = r!.markets.find((x) => x.betTypeCode === 'place')!;
    assert.deepEqual(
      m.payouts.map((p) => [p.selection, p.payoutPer100]),
      [
        ['1', 100],
        ['6', 120],
      ],
    );
  });

  test('単勝・2連単', () => {
    assert.equal(
      r!.markets.find((x) => x.betTypeCode === 'win')!.payouts[0]!.payoutPer100,
      150,
    );
    assert.equal(
      r!.markets.find((x) => x.betTypeCode === 'exacta')!.payouts[0]!.selection,
      '1-6',
    );
  });

  test('返還はなし・決まり手は逃げ・気象が取れる', () => {
    assert.deepEqual(r!.refunded, []);
    assert.equal(r!.decidedBy, '逃げ');
    assert.equal((r!.weather as any).airTemp, '35.0');
    assert.equal((r!.weather as any).windSpeed, '4');
  });

  test('まだ確定していないページは null', () => {
    assert.equal(parseRaceResult('<html><body>データがありません</body></html>'), null);
    assert.equal(parseRaceResult('<html><body><table></table></body></html>'), null);
  });
});

describe('500pt で 1-6-5 を買っていた場合', () => {
  test('払戻は 71,950pt', async () => {
    const { calcPayout } = await import('../apps/web/src/core/payout.ts');
    const r = parseRaceResult(HTML)!;
    const tri = r.markets.find((x) => x.betTypeCode === 'trifecta')!;
    assert.equal(calcPayout('1-6-5', 500, tri.payouts), 71_950);
    assert.equal(calcPayout('1-6-4', 500, tri.payouts), 0);
  });
});
