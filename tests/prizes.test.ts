import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findMoneyWord } from '../apps/web/src/lib/prizes.ts';

describe('景品のチェック', () => {
  test('ふつうの景品は通る', () => {
    for (const ok of [
      '焼肉おごり',
      'ラーメン一杯',
      '自販機のジュース',
      '肩たたき券',
      'next の掃除当番を代わる',
      '好きなラーメン屋を選べる権利',
    ]) {
      assert.equal(findMoneyWord(ok), null, ok);
    }
  });

  test('換金できるものは弾く', () => {
    assert.equal(findMoneyWord('現金'), '現金');
    assert.equal(findMoneyWord('アマゾンギフト券 1枚'), 'ギフト券');
    assert.equal(findMoneyWord('ＰａｙＰａｙで送金'), 'paypay');
    assert.equal(findMoneyWord('商品券をあげる'), '商品券');
    assert.equal(findMoneyWord('ビットコイン'), 'ビットコイン');
  });

  test('金額の直書きも弾く', () => {
    assert.equal(findMoneyWord('1000円'), '金額');
    assert.equal(findMoneyWord('1 万円ぶん'), '金額');
    assert.equal(findMoneyWord('５００円のなにか'), '金額');
  });

  test('空白や中黒を挟んで書いても見つける', () => {
    assert.equal(findMoneyWord('ギフト 券'), 'ギフト券');
    assert.equal(findMoneyWord('ク オ カード'), 'クオカード');
    assert.equal(findMoneyWord('クオ・カード'), 'クオカード');
  });
});
