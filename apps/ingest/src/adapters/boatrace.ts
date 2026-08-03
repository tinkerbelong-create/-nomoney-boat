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
} from '../../../web/src/core/index.ts';
import { parseRaceResult } from '../../../web/src/core/raceresult.ts';
import { parseEntrants } from '../../../web/src/core/racelist.ts';
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
    const grade = detectGradeFromTitle(title);
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
    return parseEntrants(html, externalKey);
  }

  /**
   * 1つの場の全レースの出走メンバーを、1回のアクセスでまとめて取る。
   *
   * レース一覧ページには12レース分の選手名・登録番号・級別がすべて載っている。
   * レースごとに出走表ページを開くと144アクセス・30分かかっていたのが、
   * これなら開催場の数（十数回）で済む。
   *
   * ただし勝率やモーターの数字までは載っていない。
   * そちらは利用者がそのレースを開いたときにオッズと同じ要領で取りに行く。
   */
  async fetchVenueEntrants(
    dateYmd: string,
    jcd: string,
  ): Promise<Map<number, EntrantDraft[]>> {
    const html = await fetchHtml(`${BASE}/raceindex?jcd=${jcd}&hd=${dateYmd}`);
    return parseVenueEntrants(html);
  }

  // -------------------------------------------------------------------
  // 結果（確定払戻金）
  // -------------------------------------------------------------------

  async fetchResult(externalKey: string): Promise<ResultDraft | null> {
    const { dateYmd, venueCode, raceNo } = parseBoatraceEventKey(externalKey);
    const html = await fetchHtml(
      `${BASE}/raceresult?rno=${raceNo}&jcd=${venueCode}&hd=${dateYmd}`,
    );
    return parseRaceResult(html) as ResultDraft | null;
  }
}

// =====================================================================
// 出走表の解析（テストできるよう通信と切り離してある）
// =====================================================================

/**
 * レース一覧ページ（raceindex）から、レース番号ごとの出走メンバーを取る。
 *
 * 1行が1レースで、行の中に選手ページへのリンクが6つ並ぶ。
 * リンクの href に登録番号（toban）が入っているのでそこから拾い、
 * 級別は同じセルの文字から拾う。艇番は並び順（公式は必ず1号艇から）。
 */
export function parseVenueEntrants(html: string): Map<number, EntrantDraft[]> {
  const $ = cheerio.load(html);
  const out = new Map<number, EntrantDraft[]>();

  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const cells = $tr.find('td');
    if (cells.length < 4) return;

    const rm = /^(\d{1,2})R$/.exec(cleanText(cells.eq(0).text()));
    if (!rm) return;
    const raceNo = Number(rm[1]);
    if (out.has(raceNo)) return;

    const racers: { toban: string; name: string; cls?: string }[] = [];
    cells.each((__, td) => {
      const $td = $(td);
      const a = $td.find('a[href*="racersearch"]').first();
      if (!a.length) return;
      const toban = /toban=(\d+)/.exec(a.attr('href') ?? '')?.[1];
      const name = cleanText(a.text());
      if (!toban || !name) return;
      // 同じセルに複数の選手が入ることはない
      if (racers.some((r) => r.toban === toban && r.name === name)) {
        // 同一選手が同じレースに2回出ることはないので、重複は別セルの取り違え
      }
      racers.push({
        toban,
        name,
        cls: /(A1|A2|B1|B2)/.exec(cleanText($td.text()))?.[1],
      });
    });

    if (racers.length < 2) return;

    out.set(
      raceNo,
      racers.slice(0, 6).map((r, i) => ({
        slotCode: String(i + 1),
        numberLabel: `${i + 1}号艇`,
        name: r.name,
        meta: { racerId: r.toban, racerClass: r.cls },
        sortOrder: i + 1,
      })),
    );
  });

  return out;
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

/**
 * グレード（SG / G1 など）の判定。
 *
 * 以前はページのHTML全体を見ていたが、公式サイトはどのページにも
 * 「SG・PG1スケジュール」というメニューのリンクを載せている。
 * そのため全レースがSGと判定されていた。
 *
 * グレードは公式サイトでは画像のバッジで表示されており、文字としては
 * 開催タイトルにしか現れない。誤ったバッジを出すくらいなら出さないほうがよいので、
 * 開催タイトルにグレード表記があるときだけ返す。
 */
export function detectGradeFromTitle(title: string): string | undefined {
  const t = title.replace(/[Ｇ]/g, 'G').replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  if (/\bSG\b/.test(t)) return 'SG';
  if (/\bPG\s?1\b/.test(t)) return 'PG1';
  if (/\bG1\b/.test(t)) return 'G1';
  if (/\bG2\b/.test(t)) return 'G2';
  if (/\bG3\b/.test(t)) return 'G3';
  return undefined;
}

// 出走表の解析は Web からも使うので core に置いてある。
// テストと取り込みワーカーの都合でここからも見えるようにしておく。
export { parseEntrants };
