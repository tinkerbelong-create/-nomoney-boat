/**
 * 出走表の解析の検証。
 *
 * HTMLは 2026-08-02 丸亀2R の公式出走表ページの構造をそのまま写したもの。
 * ここで守りたいのは次の3点。
 *   1. 艇番が1〜6で正しく振られること（公式は全角数字で書いている）
 *   2. 選手名が入ること（顔写真のリンクを名前と間違えない）
 *   3. 勝率が「全国勝率」であること（平均STを勝率として出さない）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseEntrants } from '../apps/ingest/src/adapters/boatrace.ts';

/** 選手1人分の tbody。公式と同じく rowspan で1行目にまとめられている。 */
function racerBlock(opts: {
  lane: string; // 全角
  color: string;
  toban: string;
  cls: string;
  name: string;
  branch: string;
  home: string;
  age: string;
  weight: string;
  avgSt: string;
  national: [string, string, string];
  local: [string, string, string];
  motor: [string, string, string];
  boat: [string, string, string];
}): string {
  return `
  <tbody class="is-fs12">
    <tr>
      <td class="is-fs14 is-fBold is-boatColor${opts.color}" rowspan="4">${opts.lane}</td>
      <td rowspan="4">
        <a href="/owpc/pc/data/racersearch/profile?toban=${opts.toban}"
          ><img src="/racerphoto/${opts.toban}.jpg" alt="" /></a>
      </td>
      <td class="is-fs11" rowspan="4">
        ${opts.toban} / ${opts.cls}<br />
        <a href="/owpc/pc/data/racersearch/profile?toban=${opts.toban}">${opts.name}</a><br />
        ${opts.branch}/${opts.home}<br />
        ${opts.age}歳/${opts.weight}kg
      </td>
      <td rowspan="4">F0<br />L0<br />${opts.avgSt}</td>
      <td rowspan="4">${opts.national.join('<br />')}</td>
      <td rowspan="4">${opts.local.join('<br />')}</td>
      <td rowspan="4">${opts.motor.join('<br />')}</td>
      <td rowspan="4">${opts.boat.join('<br />')}</td>
      <td rowspan="4"></td>
      <td>4</td><td>8</td><td>2</td>
    </tr>
    <tr><td>3</td><td>1</td><td>6</td></tr>
    <tr><td>.26</td><td>.19</td><td>.27</td></tr>
    <tr><td>4</td><td>3</td><td>3</td></tr>
  </tbody>`;
}

const RACERS = [
  { lane: '１', color: '1', toban: '5189', cls: 'A2', name: '藤原 早菜', branch: '岡山', home: '岡山', age: '25', weight: '45.5', avgSt: '0.20', national: ['5.26', '30.43', '51.45'], local: ['4.83', '16.67', '50.00'], motor: ['43', '30.00', '48.57'], boat: ['33', '36.36', '54.55'] },
  { lane: '２', color: '2', toban: '3611', cls: 'A2', name: '岩崎 芳美', branch: '徳島', home: '熊本', age: '53', weight: '47.4', avgSt: '0.14', national: ['6.17', '41.75', '63.11'], local: ['6.16', '46.88', '57.81'], motor: ['53', '33.95', '49.30'], boat: ['55', '50.00', '60.00'] },
  { lane: '３', color: '3', toban: '4400', cls: 'B1', name: '加藤 奈月', branch: '福井', home: '福井', age: '38', weight: '52.7', avgSt: '0.18', national: ['4.08', '16.28', '33.72'], local: ['5.33', '27.78', '55.56'], motor: ['13', '28.08', '40.39'], boat: ['51', '11.11', '33.33'] },
  { lane: '４', color: '4', toban: '5342', cls: 'B2', name: '原村 百那', branch: '山口', home: '山口', age: '24', weight: '46.5', avgSt: '0.17', national: ['2.33', '7.94', '14.29'], local: ['0.00', '0.00', '0.00'], motor: ['63', '24.18', '37.91'], boat: ['6', '30.00', '45.00'] },
  { lane: '５', color: '5', toban: '5250', cls: 'B1', name: '嶋田 有里', branch: '長崎', home: '熊本', age: '24', weight: '45.0', avgSt: '0.19', national: ['4.80', '22.64', '44.34'], local: ['0.00', '0.00', '0.00'], motor: ['9', '33.17', '54.27'], boat: ['29', '27.27', '27.27'] },
  { lane: '６', color: '6', toban: '5370', cls: 'B2', name: '日隈 茜', branch: '福岡', home: '大分', age: '24', weight: '47.0', avgSt: '0.19', national: ['1.31', '2.86', '2.86'], local: ['1.35', '0.00', '0.00'], motor: ['35', '30.05', '48.36'], boat: ['21', '33.33', '33.33'] },
] as const;

function buildPage(blocks: string[]): string {
  return `<html><body>
    <table class="is-w748">
      <thead><tr><th>枠</th><th>ボートレーサー</th><th>全国</th><th>当地</th><th>モーター</th><th>ボート</th></tr></thead>
      ${blocks.join('\n')}
    </table>
  </body></html>`;
}

const HTML = buildPage(RACERS.map((r) => racerBlock({ ...r } as any)));

describe('出走表の解析', () => {
  const entrants = parseEntrants(HTML, 'boatrace:20260802:15:02');

  test('6艇ぶん取れる', () => {
    assert.equal(entrants.length, 6);
  });

  test('艇番が1〜6で重複しない（全角数字を読めている）', () => {
    assert.deepEqual(
      entrants.map((e) => e.slotCode),
      ['1', '2', '3', '4', '5', '6'],
    );
  });

  test('選手名が入る（顔写真のリンクを名前と間違えない）', () => {
    assert.deepEqual(
      entrants.map((e) => e.name),
      ['藤原 早菜', '岩崎 芳美', '加藤 奈月', '原村 百那', '嶋田 有里', '日隈 茜'],
    );
  });

  test('勝率が全国勝率になっている（平均STではない）', () => {
    const m = entrants[0]!.meta as any;
    assert.equal(m.nationalWin, '5.26');
    assert.equal(m.avgSt !== '5.26', true);
    // 旧画面が見る rates も先頭が全国勝率であること
    assert.equal((m.rates as string[])[0], '5.26');
  });

  test('2連率・当地・モーター・ボートがそれぞれ正しい欄から取れる', () => {
    const m = entrants[1]!.meta as any;
    assert.equal(m.nationalTop2, '41.75');
    assert.equal(m.nationalTop3, '63.11');
    assert.equal(m.localWin, '6.16');
    assert.equal(m.motorNo, '53');
    assert.equal(m.motorTop2, '33.95');
    assert.equal(m.boatNo, '55');
    assert.equal(m.boatTop2, '50.00');
  });

  test('登録番号・級別・支部・年齢が取れる', () => {
    const m = entrants[0]!.meta as any;
    assert.equal(m.racerId, '5189');
    assert.equal(m.racerClass, 'A2');
    assert.equal(m.branch, '岡山');
    assert.equal(m.age, '25');
  });

  test('データがないページでは空を返す', () => {
    assert.deepEqual(parseEntrants('<html><body>データがありません</body></html>', 'x'), []);
  });
});

/**
 * レース一覧ページから12レース分の出走メンバーをまとめて取る。
 * 構造は 2026-08-02 びわこ（第31回オーシャンカップ）のページに合わせている。
 */
import { parseVenueEntrants, detectGradeFromTitle } from '../apps/ingest/src/adapters/boatrace.ts';

function racerCell(toban: string, name: string, cls: string): string {
  return `<td><a href="/owpc/pc/data/racersearch/profile?toban=${toban}&hd=20260802">${name}</a> ${cls}</td>`;
}

const INDEX_HTML = `<html><body><table>
  <tr><th>レース</th><th>締切予定時刻/投票</th><th>出場レーサー</th></tr>
  <tr>
    <td><a href="/owpc/pc/race/racelist?rno=5&jcd=11&hd=20260802">5R</a></td>
    <td>12:40</td>
    <td><a href="/owpc/VoteConfirm.xhtml?voteTagId=x">投票</a></td>
    ${racerCell('4980', '佐々木 完太', 'A1')}
    ${racerCell('4030', '森高 一真', 'A1')}
    ${racerCell('3716', '石渡 鉄兵', 'A1')}
    ${racerCell('4886', '入海 馨', 'A2')}
    ${racerCell('4760', '山崎 郡', 'A1')}
    ${racerCell('4290', '稲田 浩二', 'A1')}
    <td><a href="/owpc/pc/race/odds3t?rno=5&jcd=11&hd=20260802">オッズ</a></td>
  </tr>
  <tr>
    <td><a href="/owpc/pc/race/racelist?rno=6&jcd=11&hd=20260802">6R</a></td>
    <td>13:10</td>
    <td><a href="/owpc/VoteConfirm.xhtml?voteTagId=y">投票</a></td>
    ${racerCell('3941', '池田 浩二', 'A1')}
    ${racerCell('4166', '吉田 拡郎', 'A1')}
    ${racerCell('4590', '渡邉 優美', 'A1')}
    ${racerCell('4586', '磯部 誠', 'A1')}
    ${racerCell('4847', '佐藤 隆太郎', 'A1')}
    ${racerCell('4024', '井口 佳典', 'A1')}
    <td><a href="/owpc/pc/race/odds3t?rno=6&jcd=11&hd=20260802">オッズ</a></td>
  </tr>
</table></body></html>`;

describe('レース一覧からの出走メンバー', () => {
  const map = parseVenueEntrants(INDEX_HTML);

  test('レース番号ごとに6人ぶん取れる', () => {
    assert.equal(map.size, 2);
    assert.equal(map.get(5)!.length, 6);
    assert.equal(map.get(6)!.length, 6);
  });

  test('艇番は1〜6、名前と登録番号が入る', () => {
    const r5 = map.get(5)!;
    assert.deepEqual(r5.map((e) => e.slotCode), ['1', '2', '3', '4', '5', '6']);
    assert.equal(r5[0]!.name, '佐々木 完太');
    assert.equal((r5[0]!.meta as any).racerId, '4980');
    assert.equal((r5[3]!.meta as any).racerClass, 'A2');
    assert.equal(r5[5]!.name, '稲田 浩二');
  });

  test('投票リンクやオッズリンクを選手と間違えない', () => {
    for (const list of map.values()) {
      for (const e of list) {
        assert.match((e.meta as any).racerId, /^\d{4}$/);
      }
    }
  });
});

describe('グレード判定', () => {
  test('メニューの「SG・PG1」に釣られない（開催名だけを見る）', () => {
    // 以前はページ全体を見ていたため、全レースがSGになっていた
    assert.equal(detectGradeFromTitle('第３１回オーシャンカップ'), undefined);
    assert.equal(detectGradeFromTitle('男女Ｗ優勝戦 大阪スポーツカップ'), undefined);
  });

  test('開催名に書いてあるときは拾う', () => {
    assert.equal(detectGradeFromTitle('G3 オールレディース'), 'G3');
    assert.equal(detectGradeFromTitle('Ｇ１ 開設７０周年記念'), 'G1');
    assert.equal(detectGradeFromTitle('SG 第31回オーシャンカップ'), 'SG');
  });
});
