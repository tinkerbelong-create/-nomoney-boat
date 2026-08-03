/**
 * 結果ページ（raceresult）の解析。
 *
 * ここに置いているのは、取り込みワーカーだけでなく Web 側からも使うため。
 * 画面の「更新」ボタンを押したときに、その場で結果を取りに行って
 * 精算できるようにしてある。
 *
 * cheerio を使うのでサーバー専用。core/index.ts からは再輸出しないこと
 * （クライアントの読み込みが重くなるため）。
 */

import * as cheerio from 'cheerio';
import { getBoatraceBetType } from './betTypes.ts';
import { normalizeSelection } from './selection.ts';

export interface PayoutDraft {
  selection: string;
  payoutPer100: number;
  popularity?: number;
}

export interface MarketResultDraft {
  betTypeCode: string;
  payouts: PayoutDraft[];
}

export interface RaceResult {
  status: 'resolved' | 'cancelled';
  markets: MarketResultDraft[];
  placings: { rank: number; slot: string; name: string; time?: string }[];
  refunded: string[];
  weather: Record<string, unknown>;
  decidedBy?: string;
}

/** 公式サイトの勝式表記 → 内部コード */
const PAYOUT_LABEL_TO_CODE: Record<string, string> = {
  '3連単': 'trifecta',
  '3連複': 'trio',
  '2連単': 'exacta',
  '2連複': 'quinella',
  単勝: 'win',
  複勝: 'place',
};

/**
 * 払戻金表に出てくる勝式の名前すべて。
 * 「拡連複」はこのサイトでは扱わないが、行の区切りを見分けるために必要。
 */
const ALL_PAYOUT_LABELS = [...Object.keys(PAYOUT_LABEL_TO_CODE), '拡連複'];

function cleanText(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** 結果ページのHTMLを解析する。まだ確定していなければ null。 */
export function parseRaceResult(html: string): RaceResult | null {
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  if (/データがありません/.test(bodyText)) return null;

  if (/中止/.test(bodyText) && !/払戻金/.test(bodyText)) {
    return { status: 'cancelled', markets: [], placings: [], refunded: [], weather: {} };
  }

  const payoutRows = extractPayoutRows($);
  if (payoutRows.length === 0) return null; // まだ確定していない

  return {
    status: 'resolved',
    markets: buildMarkets(payoutRows),
    placings: extractPlacings($),
    refunded: extractRefunded($),
    weather: extractWeather($),
    decidedBy: extractDecidedBy($),
  };
}

interface PayoutRow {
  label: string;   // '3連単'
  combo: string;   // '1-2-5'
  yen: number;     // 2380
  popularity?: number;
}

/**
 * 払戻金テーブルの行を抜く。
 *
 * 「勝式 / 組番 / 払戻金 / 人気」の4列。ただし複勝のように
 * 勝式セルが空の行が続く（rowspan的な表現）ので、直前の勝式を引き継ぐ。
 */
export function extractPayoutRows($: cheerio.CheerioAPI): PayoutRow[] {
  const rows: PayoutRow[] = [];
  let currentLabel = '';

  $('table').each((_, table) => {
    const $t = $(table);
    if (!/払戻金/.test($t.text())) return;

    $t.find('tr').each((__, tr) => {
      const cells = $(tr)
        .find('td, th')
        .map((___, td) => cleanText($(td).text()))
        .get();
      if (cells.length === 0) return;

      // ヘッダ行はスキップ
      if (cells.some((c) => c === '払戻金') && cells.some((c) => c === '勝式')) return;

      // 勝式のセルは、複勝のように行をまたいで省略される（rowspan 的な表現）ので
      // 直前の勝式を引き継ぐ。
      //
      // ただし「拡連複」のように扱わない勝式が来たときは、必ず引き継ぎを切る。
      // これをしないと、拡連複の3行が直前の「2連複」の当たり目として
      // 取り込まれてしまい、本来は外れの買い目が的中になってしまう。
      const anyLabel = cells.find((c) => ALL_PAYOUT_LABELS.includes(c));
      if (anyLabel) currentLabel = anyLabel in PAYOUT_LABEL_TO_CODE ? anyLabel : '';
      if (!currentLabel) return;

      const combo = cells.find((c) => /^[1-6]([-=][1-6]){0,2}$/.test(c));
      const yenCell = cells.find((c) => /^[¥￥]?[\d,]+$/.test(c) && /[¥￥]|,|\d{3,}/.test(c));
      if (!combo || !yenCell) return;

      const yen = Number(yenCell.replace(/[¥￥,]/g, ''));
      if (!Number.isFinite(yen) || yen <= 0) return;

      // 人気は払戻金より後ろにある小さい整数
      const yenIdx = cells.indexOf(yenCell);
      const popCell = cells.slice(yenIdx + 1).find((c) => /^\d{1,3}$/.test(c));

      rows.push({
        label: currentLabel,
        combo,
        yen,
        popularity: popCell ? Number(popCell) : undefined,
      });
    });
  });

  return rows;
}

/** 払戻行を賭け式ごとのマーケット結果にまとめる */
export function buildMarkets(rows: PayoutRow[]): MarketResultDraft[] {
  const byCode = new Map<string, PayoutDraft[]>();

  for (const row of rows) {
    const code = PAYOUT_LABEL_TO_CODE[row.label];
    if (!code) continue;

    const betType = getBoatraceBetType(code);
    // 公式表記の組番を、こちらの正規形に通し直す。
    // '1=2' のような順不同表記も、必ず昇順ソートされた形になる。
    const picks = row.combo.split(/[-=]/);
    let selection: string;
    try {
      selection = normalizeSelection(betType, picks);
    } catch {
      console.warn(`[boatrace] 組番を解釈できませんでした: ${row.label} ${row.combo}`);
      continue;
    }

    const list = byCode.get(code) ?? [];
    // 同じ買い目が二重に出た場合は最初のものを採用
    if (!list.some((p) => p.selection === selection)) {
      list.push({ selection, payoutPer100: row.yen, popularity: row.popularity });
    }
    byCode.set(code, list);
  }

  return [...byCode.entries()].map(([betTypeCode, payouts]) => ({ betTypeCode, payouts }));
}

/** 着順 */
function extractPlacings($: cheerio.CheerioAPI) {
  const out: { rank: number; slot: string; name: string; time?: string }[] = [];

  $('table').each((_, table) => {
    if (out.length > 0) return;
    const $t = $(table);
    const head = cleanText($t.find('tr').first().text());
    if (!/着/.test(head) || !/枠|ボートレーサー/.test(head)) return;

    $t.find('tr').each((__, tr) => {
      const cells = $(tr)
        .find('td')
        .map((___, td) => cleanText($(td).text()))
        .get();
      if (cells.length < 3) return;

      const rank = parseRank(cells[0]!);
      const slot = cells[1];
      if (rank === null || !slot || !/^[1-6]$/.test(slot)) return;

      const nameCell = cells[2] ?? '';
      const name = cleanText(nameCell.replace(/^\d{4}\s*/, ''));
      const time = cells[3] && /['"″′]/.test(cells[3]) ? cells[3] : undefined;

      out.push({ rank, slot, name, time });
    });
  });

  return out;
}

function parseRank(s: string): number | null {
  const zen = '０１２３４５６７８９';
  const normalized = s.replace(/[０-９]/g, (c) => String(zen.indexOf(c)));
  const kanji: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  if (kanji[s]) return kanji[s]!;
  const m = /^(\d)$/.exec(normalized.trim());
  return m ? Number(m[1]) : null;
}

/** 返還艇。返還があると該当艇を含む買い目が返還になる。 */
function extractRefunded($: cheerio.CheerioAPI): string[] {
  const out = new Set<string>();
  $('table').each((_, table) => {
    const $t = $(table);
    if (!/返還/.test($t.text())) return;
    $t.find('tr').each((__, tr) => {
      const text = cleanText($(tr).text());
      if (!/返還/.test(text)) return;
      for (const m of text.replace('返還', '').matchAll(/[1-6]/g)) out.add(m[0]);
    });
  });
  return [...out].sort();
}

function extractWeather($: cheerio.CheerioAPI): Record<string, unknown> {
  const text = cleanText($('body').text());
  const pick = (re: RegExp) => re.exec(text)?.[1];
  return {
    airTemp: pick(/気温\s*([\d.]+)℃/),
    waterTemp: pick(/水温\s*([\d.]+)℃/),
    windSpeed: pick(/風速\s*([\d.]+)m/),
    waveHeight: pick(/波高\s*([\d.]+)cm/),
  };
}

function extractDecidedBy($: cheerio.CheerioAPI): string | undefined {
  const kimarite = ['逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ'];
  let found: string | undefined;
  $('table').each((_, table) => {
    if (found) return;
    const $t = $(table);
    if (!/決まり手/.test($t.text())) return;
    const text = cleanText($t.text()).replace('決まり手', '');
    found = kimarite.find((k) => text.includes(k));
  });
  return found;
}
