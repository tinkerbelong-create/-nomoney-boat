/**
 * 直前情報の解析の検証。
 * 2026-08-02 常滑6R の実際のページの構造に合わせている。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseBeforeInfo } from '../apps/web/src/core/beforeinfo.ts';

function racer(
  slot: string,
  toban: string,
  name: string,
  weight: string,
  time: string,
  tilt: string,
): string {
  return `
  <tbody>
    <tr>
      <td class="is-boatColor${slot}" rowspan="4">${slot}</td>
      <td rowspan="4"><a href="/owpc/pc/data/racersearch/profile?toban=${toban}"><img src="/racerphoto/${toban}.jpg"></a></td>
      <td rowspan="4"><a href="/owpc/pc/data/racersearch/profile?toban=${toban}">${name}</a></td>
      <td>${weight}</td>
      <td rowspan="4">${time}</td>
      <td rowspan="4">${tilt}</td>
      <td rowspan="4"></td>
      <td rowspan="4"></td>
      <td>R</td><td></td>
    </tr>
    <tr><td>進入</td><td></td></tr>
    <tr><td>0.0</td><td>ST</td><td></td></tr>
    <tr><td>着順</td><td></td></tr>
  </tbody>`;
}

const HTML = `<html><body>
<table>
  <thead><tr><th>枠</th><th>写真</th><th>ボートレーサー</th><th>体重</th><th>展示タイム</th><th>チルト</th><th>プロペラ</th><th>部品交換</th><th>前走成績</th></tr></thead>
  ${racer('1', '5150', '坂本 雄紀', '52.0kg', '6.77', '0.0')}
  ${racer('2', '5197', '中野 仁照', '53.4kg', '6.78', '0.0')}
  ${racer('3', '5271', '杉山 太陽', '52.0kg', '6.82', '0.0')}
  ${racer('4', '5289', '佃 來紀', '52.0kg', '6.77', '0.0')}
  ${racer('5', '5407', '中岡 駿', '52.0kg', '6.78', '-0.5')}
  ${racer('6', '5222', '津田 陸翔', '52.0kg', '6.72', '0.0')}
</table>

<table>
  <tr><th>スタート展示</th></tr>
  <tr><th>コース</th><th>並び</th><th>ST</th></tr>
  <tr><td>1 <img src="/static_extra/pc/images/img_boat2_1.png"> .17</td></tr>
  <tr><td>2 <img src="/static_extra/pc/images/img_boat2_2.png"> .16</td></tr>
  <tr><td>3 <img src="/static_extra/pc/images/img_boat2_3.png"> .24</td></tr>
  <tr><td>4 <img src="/static_extra/pc/images/img_boat2_4.png"> .22</td></tr>
  <tr><td>5 <img src="/static_extra/pc/images/img_boat2_5.png"> .12</td></tr>
  <tr><td>6 <img src="/static_extra/pc/images/img_boat2_6.png"> F.02</td></tr>
</table>

<p>水面気象情報 5R時点 気温 35.0℃ 晴 風速 3m 水温 31.0℃ 波高 1cm</p>
</body></html>`;

describe('直前情報の解析（常滑6R）', () => {
  const info = parseBeforeInfo(HTML);

  test('読める', () => {
    assert.ok(info);
  });

  test('展示タイムが艇番ごとに取れる', () => {
    assert.deepEqual(
      info!.racers.map((r) => [r.slot, r.exhibitionTime]),
      [
        ['1', '6.77'],
        ['2', '6.78'],
        ['3', '6.82'],
        ['4', '6.77'],
        ['5', '6.78'],
        ['6', '6.72'],
      ],
    );
  });

  test('選手名と体重も取れる', () => {
    assert.equal(info!.racers[0]!.name, '坂本 雄紀');
    assert.equal(info!.racers[1]!.weight, '53.4kg');
  });

  test('チルトは0以外だけ意味がある', () => {
    assert.equal(info!.racers[4]!.tilt, '-0.5');
  });

  test('スタート展示は進入コース順、艇番は画像から取る', () => {
    assert.deepEqual(
      info!.start.map((s) => [s.course, s.slot, s.st]),
      [
        [1, '1', '.17'],
        [2, '2', '.16'],
        [3, '3', '.24'],
        [4, '4', '.22'],
        [5, '5', '.12'],
        [6, '6', 'F.02'],
      ],
    );
  });

  test('気象が取れる', () => {
    assert.equal(info!.weather.airTemp, '35.0');
    assert.equal(info!.weather.waterTemp, '31.0');
    assert.equal(info!.weather.windSpeed, '3');
    assert.equal(info!.weather.waveHeight, '1');
    assert.equal(info!.weather.condition, '晴');
    assert.equal(info!.weatherAt, '5R時点');
  });

  test('まだ何も出ていないページは null', () => {
    assert.equal(parseBeforeInfo('<html><body>データがありません</body></html>'), null);
    assert.equal(parseBeforeInfo('<html><body><table></table></body></html>'), null);
  });
});
