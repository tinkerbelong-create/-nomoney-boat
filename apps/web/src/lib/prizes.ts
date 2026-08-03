/**
 * 大会の景品のチェック。
 *
 * このサイトは現金・換金できるものを一切扱わない。
 * 景品は主催者が自分で用意する現実のもの（焼肉をおごる、など）だけで、
 * サイトは文字を表示するだけ。用意にも受け渡しにも関わらない。
 *
 * 参加者から集めたものが優勝者に渡る形にすると賭博になる。
 * ここで止めているのは、その一歩手前でうっかり越えないようにするため。
 *
 * 画面（入力中の警告）とサーバー（保存時の拒否）の両方で使うので、
 * server actions ではなくふつうのモジュールに置いている。
 */

const MONEY_WORDS = [
  '現金',
  'キャッシュ',
  '振込',
  '振り込み',
  'ギフト券',
  'ギフトカード',
  'アマギフ',
  'amazonギフト',
  'プリペイド',
  '電子マネー',
  'paypay',
  'ペイペイ',
  'linepay',
  'ラインペイ',
  '楽天ペイ',
  'ビットコイン',
  '暗号資産',
  '仮想通貨',
  '換金',
  '商品券',
  'クオカード',
  'quoカード',
];

/**
 * 景品の文章に換金できるものが混ざっていたら、その言葉を返す。
 * 問題なければ null。
 */
export function findMoneyWord(text: string): string | null {
  // 全角の英数字を半角に直す。「ＰａｙＰａｙ」で書かれても見つけるため。
  const normalized = text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s\-・]/g, '');

  // 「1000円」のような金額の直書きも止める
  if (/[0-9]+(万)?(円|ドル)/.test(normalized)) return '金額';

  return MONEY_WORDS.find((w) => normalized.includes(w.toLowerCase())) ?? null;
}

export const PRIZE_MAX_LENGTH = 60;

export const PRIZE_RULE_TEXT =
  '景品は主催者が自分で用意するものです。サイトは表示するだけで、' +
  '用意にも受け渡しにも関わりません。' +
  '現金・ギフト券・電子マネーなど、換金できるものは景品にできません。';
