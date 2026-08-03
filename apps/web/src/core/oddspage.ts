/**
 * オッズページのHTMLを「行 × セル」に切り出して解析する。
 *
 * 解析そのもの（買い目の組み立て）は odds.ts にある。
 * ここはHTMLから表を取り出す部分だけを担当する。
 *
 * 【なぜ別ファイルにしているか】
 *   cheerio を使うのでサーバー専用。odds.ts は投票画面（ブラウザ側）からも
 *   読むので、cheerio を混ぜてはいけない。
 *
 * 【過去の不具合】
 *   表をセルの配列に変換するのに cheerio の .map().get() を使っていたが、
 *   これは入れ子の配列を平らに潰してしまう。
 *   その結果「行の配列」ではなく「セルが一列に並んだ配列」になり、
 *   オッズ解析が a.filter is not a function で落ちていた。
 *   ここは素直なループで書くこと。
 */

import * as cheerio from 'cheerio';
import {
  parseTrifectaOdds,
  parseTrioOdds,
  parsePairOdds,
  parseWinOdds,
  parsePlaceOdds,
  type OddsMap,
  type Row,
} from './odds.ts';

/** 賭け式 → ページ内の見出し文字列 */
export const ODDS_HEADINGS: Record<string, string> = {
  trifecta: '3連単オッズ',
  trio: '3連複オッズ',
  exacta: '2連単オッズ',
  quinella: '2連複オッズ',
  win: '単勝オッズ',
  place: '複勝オッズ',
};

/**
 * オッズらしいセルかどうか（表を選ぶときの目印）。
 * 艇番（1〜6）と区別できればよいので、小数か10以上の整数を見る。
 * 公式は1000倍超を「1587」のように小数点なしで出す。
 */
function looksLikeOdds(s: string): boolean {
  return /^\d+(\.\d+)?$/.test(s) && (s.includes('.') || Number(s) >= 10);
}

function cellText(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 表を「行の配列」にする。
 * cheerio の .map().get() は入れ子を潰すので使わない。
 */
export function tableToRows($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): Row[] {
  const rows: Row[] = [];
  table.find('tr').each((_, tr) => {
    const cells: string[] = [];
    $(tr)
      .find('td, th')
      .each((__, cell) => {
        cells.push(cellText($(cell).text()));
      });
    rows.push(cells);
  });
  return rows;
}

/**
 * 指定した見出しの直後にある表を取り出す。
 *
 * 見出しと表が別の div に入っているので、兄弟だけを見る nextAll では
 * 見つからない。HTML上の登場順に並べて「見出しの次に来た表」を採る。
 * 見つからなければ、ページ内で最も行数の多い表を使う。
 */
export function collectRows($: cheerio.CheerioAPI, heading: string | undefined): Row[] {
  if (heading) {
    const flat = heading.replace(/\s+/g, '');
    const nodes = $('h1, h2, h3, h4, h5, caption, table').toArray();
    let passed = false;

    for (const el of nodes) {
      const tag = (el as any).tagName?.toLowerCase();
      if (tag === 'table') {
        if (passed) {
          const rows = tableToRows($, $(el));
          // 見出しの直後が「選手名だけの表」のこともあるので、
          // オッズらしい数字が入っている表に当たるまで先へ進む。
          if (rows.some((r) => r.some(looksLikeOdds))) return rows;
        }
        continue;
      }
      if (cellText($(el).text()).replace(/\s+/g, '').includes(flat)) passed = true;
    }
  }

  let best: Row[] = [];
  $('table').each((_, t) => {
    const rows = tableToRows($, $(t));
    if (rows.length > best.length) best = rows;
  });
  return best;
}

/** ページ全体からオッズ表を見つけて解析する */
export function parseOddsPage(
  html: string,
  betType: string,
): { odds: OddsMap; updatedAt: string | null; rows: Row[] } {
  const $ = cheerio.load(html);

  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const updatedAt =
    /オッズ更新時間\s*(\d{1,2}:\d{2})/.exec(bodyText)?.[1] ??
    (/締切時オッズ/.test(bodyText) ? '締切時' : null);

  const rows = collectRows($, ODDS_HEADINGS[betType]);

  const odds = (() => {
    switch (betType) {
      case 'trifecta':
        return parseTrifectaOdds(rows);
      case 'trio':
        return parseTrioOdds(rows);
      case 'exacta':
        return parsePairOdds(rows, true);
      case 'quinella':
        return parsePairOdds(rows, false);
      case 'win':
        return parseWinOdds(rows);
      case 'place':
        return parsePlaceOdds(rows);
      default:
        return {};
    }
  })();

  return { odds, updatedAt, rows };
}

/**
 * 読み取りの様子を人が読める形で返す（?debug=1 のとき）。
 * 直った後も残しておく。壊れたときに同じ調べ方ができる。
 */
export function diagnoseOddsPage(html: string, betType: string, url: string) {
  const $ = cheerio.load(html);
  const heading = ODDS_HEADINGS[betType];

  const tables: { rows: number; sample: string[] }[] = [];
  $('table').each((_, t) => {
    const r = tableToRows($, $(t));
    tables.push({ rows: r.length, sample: (r[1] ?? []).slice(0, 20) });
  });

  const parsed = parseOddsPage(html, betType);

  return {
    url,
    htmlLength: html.length,
    betType,
    heading,
    headingFoundInHtml: heading ? html.includes(heading) : null,
    tableCount: tables.length,
    tables: tables.slice(0, 8),
    pickedRowCount: parsed.rows.length,
    pickedFirstRows: parsed.rows.slice(0, 4),
    parsedCount: Object.keys(parsed.odds).length,
    parsedSample: Object.entries(parsed.odds).slice(0, 5),
    updatedAt: parsed.updatedAt,
  };
}
