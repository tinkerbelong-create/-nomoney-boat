/**
 * ボートレース公式サイト（boatrace.jp）のアダプタ。
 *
 * 【データ源について】
 *   robots.txt は全許可（User-agent: * / Disallow: 空）。
 *   ページはすべてサーバサイドレンダリングなので JavaScript の実行は不要。
 *   公式の「オッズ情報・結果」ダウンロードサービスは2025年3月5日に終了したため、
 *   確定払戻金は結果ページから取得する。
 *
 * 【パースの方針】
 *   CSSクラス名は公式サイトのリニューアルで変わりうるので、できるだけ
 *   「テキストの中身」を手がかりにする。たとえば払戻金テーブルは列の位置ではなく
 *   「3連単」「単勝」といった勝式名で行を特定している。
 *   これにより多少のマークアップ変更では壊れない。
 *
 *   それでも壊れたときにすぐ気づけるよう、期待する要素が見つからない場合は
 *   黙って空を返さず必ず警告を出す。
 */

import * as cheerio from 'cheerio';
import {
  BOATRACE_VENUES,
  boatraceEventKey,
  parseBoatraceEventKey,
  venueName,
  normalizeSelection,
  getBoatraceBetType,
} from '@nmb/core';
import { fetchHtml } from '../http.ts';
import type {
  SportAdapter,
  EventDraft,
  EntrantDraft,
  ResultDraft,
  MarketResultDraft,
  PayoutDraft,
} from '../types.ts';

const BASE = 'https://www.boatrace.jp/owpc/pc/race';

/** この賭け式を全レースで開く。拡連複（ワイド）は扱わない方針。 */
const BET_TYPES = ['trifecta', 'trio', 'exacta', 'quinella', 'win', 'place'];

/**
 * 公式サイトの勝式表記 → 内部コード。
 * ここに無い勝式（拡連複）は結果ページに載っていても読み飛ばす。
 */
const PAYOUT_LABEL_TO_CODE: Record<string, string> = {
  '3連単': 'trifecta',
  '3連複': 'trio',
  '2連単': 'exacta',
  '2連複': 'quinella',
  単勝: 'win',
  複勝: 'place',
};

export class BoatraceAdapter implements SportAdapter {
  readonly sportCode = 'boatrace';

  // -------------------------------------------------------------------
  // 開催スケジュール
  // -------------------------------------------------------------------

  /**
   * 指定日に開催している場を調べ、各場の全レースと締切時刻を取得する。
   *
   * 当日一覧ページから場コードだけを正規表現で抜き、そのあと場ごとの
   * レース一覧ページを読む、という2段構えにしている。
   * 当日一覧のテーブルは構造が複雑で壊れやすいが、リンクに含まれる
   * jcd= の値を拾うだけならマークアップが変わってもまず壊れない。
   */
  async fetchSchedule(dateYmd: string): Promise<EventDraft[]> {
    const indexHtml = await fetchHtml(`${BASE}/index?hd=${dateYmd}`);
    const venueCodes = extractVenueCodes(indexHtml);

    if (venueCodes.length === 0) {
      console.warn(`[boatrace] ${dateYmd}: 開催場が1つも見つかりません`);
      return [];
    }

    const events: EventDraft[] = [];
    for (const jcd of venueCodes) {
      try {
        const list = await this.fetchVenueRaces(dateYmd, jcd);
        events.push(...list);
      } catch (err) {
        console.error(`[boatrace] ${dateYmd} jcd=${jcd} のレース一覧取得に失敗:`, err);
      }
    }
    return events;
  }

  /** 1つの場の当日全レース（締切時刻つき） */
  private async fetchVenueRaces(dateYmd: string, jcd: string): Promise<EventDraft[]> {
    const html = await fetchHtml(`${BASE}/raceindex?jcd=${jcd}&hd=${dateYmd}`);
    const $ = cheerio.load(html);

    if (/データがありません/.test($('body').text())) return [];

    const title = cleanText($('h2, h3').first().text()) || `${venueName(jcd)} 開催`;
    const grade = detectGrade(html);
    const cancelled = /中止/.test($('body').text()) && !/中止順延/.test($('body').text());

    // 「1R 〜 12R」と締切時刻の対応を取る。
    // ページ内に R番号 と HH:MM が同じ表に並ぶ構造なので、テキストから対にする。
    const deadlines = extractRaceDeadlines($, dateYmd);

    if (deadlines.size === 0) {
      console.warn(`[boatrace] jcd=${jcd} hd=${dateYmd}: 締切時刻を1件も取得できませんでした`);
      return [];
    }

    const events: EventDraft[] = [];
    for (const [raceNo, deadlineAt] of [...deadlines.entries()].sort((a, b) => a[0] - b[0])) {
      events.push({
        externalKey: boatraceEventKey(dateYmd, jcd, raceNo),
        title: `${title} ${raceNo}R`,
        venueCode: jcd,
        venueName: venueName(jcd),
        raceNumber: raceNo,
        grade,
        scheduledAt: deadlineAt,
        deadlineAt,
        status: cancelled ? 'cancelled' : 'scheduled',
        meta: { seriesTitle: title },
        betTypeCodes: BET_TYPES,
      });
    }
    return events;
  }

  // -------------------------------------------------------------------
  // 出走表
  // -------------------------------------------------------------------

  async fetchEntrants(externalKey: string): Promise<EntrantDraft[]> {
    const { dateYmd, venueCode, raceNo } = parseBoatraceEventKey(externalKey);
    const html = await fetchHtml(
      `${BASE}/racelist?rno=${raceNo}&jcd=${venueCode}&hd=${dateYmd}`,
    );
    const $ = cheerio.load(html);

    if (/データがありません/.test($('body').text())) return [];

    const entrants: EntrantDraft[] = [];

    // 出走表は「1艇 = 1 tbody」の構造。艇番セルを起点に読む。
    $('table tbody').each((_, tbody) => {
      const $tb = $(tbody);
      const text = cleanText($tb.text());
      if (!text) return;

      // 登録番号(4桁) と 級別(A1/A2/B1/B2) が同居する行だけを選手行とみなす
      const regMatch = /(\d{4})\s*\/?\s*(A1|A2|B1|B2)/.exec(text);
      if (!regMatch) return;

      const slotCode = detectLaneNumber($, $tb);
      if (!slotCode) return;

      const name = extractRacerName($, $tb);
      const nums = text.match(/\d+\.\d{2}/g) ?? [];

      entrants.push({
        slotCode,
        numberLabel: `${slotCode}号艇`,
        name: name || `${slotCode}号艇`,
        meta: {
          racerId: regMatch[1],
          racerClass: regMatch[2],
          // 全国勝率・全国2連率・当地勝率・当地2連率・モーター2連率・ボート2連率の順で
          // 並ぶことが多いが、レイアウト変更に備えて生の並びも残しておく
          rates: nums.slice(0, 8),
        },
        sortOrder: Number(slotCode),
      });
    });

    if (entrants.length === 0) {
      console.warn(`[boatrace] ${externalKey}: 出走表を1件も取得できませんでした`);
    }
    return entrants.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // -------------------------------------------------------------------
  // 結果（確定払戻金）
  // -------------------------------------------------------------------

  async fetchResult(externalKey: string): Promise<ResultDraft | null> {
    const { dateYmd, venueCode, raceNo } = parseBoatraceEventKey(externalKey);
    const html = await fetchHtml(
      `${BASE}/raceresult?rno=${raceNo}&jcd=${venueCode}&hd=${dateYmd}`,
    );
    const $ = cheerio.load(html);
    const bodyText = $('body').text();

    if (/データがありません/.test(bodyText)) return null;

    // 中止の判定。結果が出ていないのに中止表記がある場合。
    if (/中止/.test(bodyText) && !/払戻金/.test(bodyText)) {
      return {
        status: 'cancelled',
        markets: [],
        placings: [],
        refunded: [],
        weather: {},
      };
    }

    const payoutRows = extractPayoutRows($);
    if (payoutRows.length === 0) return null; // まだ確定していない

    const markets = buildMarkets(payoutRows);
    const placings = extractPlacings($);
    const refunded = extractRefunded($);

    return {
      status: 'resolved',
      markets,
      placings,
      refunded,
      weather: extractWeather($),
      decidedBy: extractDecidedBy($),
    };
  }
}

// =====================================================================
// パース補助
// =====================================================================

function cleanText(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** 当日一覧ページから、開催中の場コードを重複なく抜き出す */
export function extractVenueCodes(html: string): string[] {
  const codes = new Set<string>();
  const valid = new Set(BOATRACE_VENUES.map((v) => v.code));
  for (const m of html.matchAll(/[?&]jcd=(\d{2})/g)) {
    if (valid.has(m[1]!)) codes.add(m[1]!);
  }
  return [...codes].sort();
}

/**
 * レース一覧ページから R番号 → 締切時刻(JST) の対応を作る。
 *
 * 「1R」「2R」… というセルと「10:40」「11:10」… というセルが
 * それぞれ同じ順序で並ぶ構造を利用する。
 */
export function extractRaceDeadlines(
  $: cheerio.CheerioAPI,
  dateYmd: string,
): Map<number, Date> {
  const result = new Map<number, Date>();

  $('table').each((_, table) => {
    if (result.size > 0) return;
    const $t = $(table);
    const raceNos: number[] = [];
    const times: string[] = [];

    $t.find('td, th').each((__, cell) => {
      const t = cleanText($(cell).text());
      const rm = /^(\d{1,2})R$/.exec(t);
      if (rm) raceNos.push(Number(rm[1]));
      const tm = /^(\d{1,2}):(\d{2})$/.exec(t);
      if (tm) times.push(t);
    });

    if (raceNos.length > 0 && raceNos.length === times.length) {
      raceNos.forEach((no, i) => {
        result.set(no, jstToDate(dateYmd, times[i]!));
      });
    }
  });

  return result;
}

/**
 * 'YYYYMMDD' と 'HH:MM'（JST）から Date を作る。
 *
 * ミッドナイト開催では締切が翌日0時台になることがあるため、
 * 早朝の時刻は翌日として扱う…という補正は入れていない。
 * 公式サイトは開催日ベースで時刻を出しており、実際に日付を跨ぐレースは
 * 開催日側の日付で扱うのが正しいため。
 */
export function jstToDate(dateYmd: string, hhmm: string): Date {
  const y = dateYmd.slice(0, 4);
  const m = dateYmd.slice(4, 6);
  const d = dateYmd.slice(6, 8);
  const [hh, mm] = hhmm.split(':');
  return new Date(`${y}-${m}-${d}T${hh!.padStart(2, '0')}:${mm}:00+09:00`);
}

function detectGrade(html: string): string | undefined {
  if (/SG/.test(html)) return 'SG';
  if (/PG\s?1|PG１/.test(html)) return 'PG1';
  if (/G1|Ｇ１/.test(html)) return 'G1';
  if (/G2|Ｇ２/.test(html)) return 'G2';
  if (/G3|Ｇ３/.test(html)) return 'G3';
  return undefined;
}

/** 選手ブロックから艇番(1-6)を拾う */
function detectLaneNumber($: cheerio.CheerioAPI, $tb: cheerio.Cheerio<any>): string | null {
  let lane: string | null = null;
  $tb.find('td').each((_, td) => {
    if (lane) return;
    const t = cleanText($(td).text());
    if (/^[1-6]$/.test(t)) lane = t;
  });
  if (lane) return lane;

  // クラス名 is-boatColor1 などから拾う保険
  const cls = $tb.find('[class*="boatColor"]').first().attr('class') ?? '';
  const m = /boatColor([1-6])/.exec(cls);
  return m ? m[1]! : null;
}

/** 選手名。全角スペース区切りの日本語氏名を拾う */
function extractRacerName($: cheerio.CheerioAPI, $tb: cheerio.Cheerio<any>): string {
  const link = $tb.find('a[href*="racersearch"]').first();
  if (link.length) return cleanText(link.text());

  const m = /([一-龥゠-ヿ]{1,5}[\s　]+[一-龥゠-ヿ]{1,5})/.exec(
    cleanText($tb.text()),
  );
  return m ? m[1]!.replace(/\s+/g, ' ') : '';
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

      const label = cells.find((c) => c in PAYOUT_LABEL_TO_CODE);
      if (label) currentLabel = label;
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
