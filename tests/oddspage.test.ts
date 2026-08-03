/**
 * オッズページを「HTMLのまま」渡して検証する。
 *
 * これまでのテストは、すでに行×セルに切り分けた配列を渡していた。
 * そのため、HTMLから配列を作る部分の不具合
 *   （cheerio の .map().get() が入れ子を潰し、行がバラバラの文字列になる）
 * をまったく検出できず、本番でオッズが一度も出なかった。
 *
 * 値は 2026-08-02 桐生1R の実際のオッズページから取ったもの。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseOddsPage, collectRows, tableToRows } from '../apps/web/src/core/oddspage.ts';
import * as cheerio from 'cheerio';

/** 3連単オッズ表。1着ごとに (2着, 3着, オッズ) が並ぶ。 */
const TRIFECTA_ROWS: string[][] = [
  ['2', '3', '23.2', '1', '3', '38.3', '1', '2', '74.0', '1', '2', '91.2', '1', '2', '169.6', '1', '2', '169.6'],
  ['4', '26.7', '4', '43.2', '4', '75.6', '3', '128.0', '3', '303.8', '3', '192.0'],
  ['5', '46.4', '5', '53.5', '5', '74.5', '5', '86.9', '4', '216.5', '4', '260.9'],
  ['6', '49.6', '6', '64.4', '6', '396.7', '6', '108.8', '6', '172.5', '5', '308.4'],
  ['3', '2', '36.6', '3', '1', '37.5', '2', '1', '51.1', '2', '1', '108.8', '2', '1', '172.5', '2', '1', '228.7'],
];

function table(rows: string[][], id = ''): string {
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('');
  return `<table id="${id}"><tbody>${body}</tbody></table>`;
}

/** 公式と同じく、見出しと表は別の div に入っている */
const HTML = `<html><body>
  <div class="nav"><table id="nav">
    <tr><th>レース</th><td>1R</td><td>2R</td></tr>
    <tr><th>締切予定時刻</th><td>15:28</td><td>16:03</td></tr>
  </table></div>

  <div class="update">オッズ更新時間
  13:09</div>

  <div class="heading"><h3 class="title16__1">3連単オッズ</h3></div>
  <div class="table1">${table(
    [['1', '飯塚 響', '', '2', '冨名腰 桃奈', ''], ...TRIFECTA_ROWS],
    'odds',
  )}</div>
</body></html>`;

describe('オッズページをHTMLから読む', () => {
  test('表は「行の配列」になる（平らに潰れない）', () => {
    const $ = cheerio.load(`<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>`);
    const rows = tableToRows($, $('table'));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], ['a', 'b']);
    assert.deepEqual(rows[1], ['c']);
    // 行が配列であること。ここが崩れると filter が使えず全部落ちる。
    assert.equal(typeof (rows[0] as any).filter, 'function');
  });

  test('見出しと表が別の div でも、正しい表を選べる', () => {
    const $ = cheerio.load(HTML);
    const rows = collectRows($, '3連単オッズ');
    assert.ok(rows.length >= 6);
    assert.deepEqual(rows[1], TRIFECTA_ROWS[0]);
  });

  test('見出しの直後が選手名だけの表でも、その次のオッズ表を選ぶ', () => {
    const html = `<html><body>
      <h3>3連単オッズ</h3>
      <div>${table([['1', '飯塚 響', '', '2', '冨名腰 桃奈', '']], 'head')}</div>
      <div>${table(TRIFECTA_ROWS, 'odds')}</div>
    </body></html>`;
    const $ = cheerio.load(html);
    const rows = collectRows($, '3連単オッズ');
    assert.deepEqual(rows[0], TRIFECTA_ROWS[0]);
  });

  test('オッズが買い目に変換される', () => {
    const { odds, updatedAt } = parseOddsPage(HTML, 'trifecta');
    assert.equal(updatedAt, '13:09');
    assert.equal(odds['1-2-3'], 23.2);
    assert.equal(odds['1-2-4'], 26.7);
    assert.equal(odds['1-2-6'], 49.6);
    assert.equal(odds['1-3-2'], 36.6);
    assert.equal(odds['6-1-2'], 169.6);
    assert.equal(odds['5-1-2'], 169.6);
    assert.ok(Object.keys(odds).length >= 30);
  });

  test('空のページでも落ちない', () => {
    const r = parseOddsPage('<html><body></body></html>', 'trifecta');
    assert.deepEqual(r.odds, {});
  });
});
