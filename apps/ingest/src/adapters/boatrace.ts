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

    return {
      status: 'resolved',
      markets: buildMarkets(payoutRows),
      placings: extractPlacings($),
      refunded: extractRefunded($),
      weather: extractWeather($),
      decidedBy: extractDecidedBy($),
    };
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

export function parseEntrants(html: string, externalKey: string): EntrantDraft[] {
  const $ = cheerio.load(html);

  if (/データがありません/.test($('body').text())) return [];

  const entrants: EntrantDraft[] = [];

    // 出走表は「1艇 = 1 tbody」の構造。
    //
    // 1行目のセルの並びは次のとおり（2行目以降は rowspan で省略される）。
    //   枠 / 写真 / 登録番号・級別・氏名・支部・年齢体重 / F数・L数・平均ST /
    //   全国(勝率・2連率・3連率) / 当地(同) / モーター(No・2連率・3連率) /
    //   ボート(同) / 今節成績…
    //
    // 「F数 L数 平均ST」のセルを目印にして、そこから右へ数えることで
    // レイアウトが多少変わっても崩れないようにしている。
    $('table tbody').each((_, tbody) => {
      const $tb = $(tbody);
      const text = cleanText($tb.text());
      if (!text) return;

      // 登録番号(4桁) と 級別(A1/A2/B1/B2) が同居する行だけを選手行とみなす
      const regMatch = /(\d{4})\s*\/?\s*(A1|A2|B1|B2)/.exec(text);
      if (!regMatch) return;

      const $tds = $tb.find('tr').first().find('td');
      const tdText = $tds.map((__, td) => cleanText($(td).text())).get();

      // セルの中身は <br> 区切りで数値が縦に3つ並ぶ。
      // テキストをそのまま繋げると「53」と「33.95」が「5333.95」になって
      // 桁が壊れるので、必ず <br> で切ってから読む。
      const parts = (i: number) => splitByBr($tds.eq(i).html());

      // 「F0 / L0 / 平均ST」のセルの位置。
      // ここから +1 が全国、+2 が当地、+3 がモーター、+4 がボート。
      const stIdx = tdText.findIndex((t) => /F\s*\d/.test(t) && /L\s*\d/.test(t));
      const isDec = (s: string) => /^\d+\.\d+$/.test(s);

      let avgSt: string | undefined;
      let national: string[] = [];
      let local: string[] = [];
      let motorCell: string[] = [];
      let boatCell: string[] = [];
      let profile = '';

      if (stIdx >= 0) {
        avgSt = parts(stIdx).filter(isDec).at(-1);
        national = parts(stIdx + 1).filter(isDec);
        local = parts(stIdx + 2).filter(isDec);
        motorCell = parts(stIdx + 3);
        boatCell = parts(stIdx + 4);
        profile = parts(stIdx - 1).join(' ');
      } else {
        // 予備。セルの構造が変わったときは、選手ブロック全体の数値の並びから拾う。
        // 並びは 平均ST → 全国3つ → 当地3つ → モーター2つ → ボート2つ。
        console.warn(`[boatrace] ${externalKey}: 成績欄の位置を特定できませんでした`);
        const all = text.match(/\d+\.\d{2}/g) ?? [];
        avgSt = all[0];
        national = all.slice(1, 4);
        local = all.slice(4, 7);
        motorCell = ['', ...all.slice(7, 9)];
        boatCell = ['', ...all.slice(9, 11)];
        profile = text;
      }

      const motor = motorCell.filter(isDec);
      const boat = boatCell.filter(isDec);

      const place = /([一-龥ヶ]{2,4})\s*\/\s*([一-龥ヶ]{2,4})/.exec(profile);
      const body = /(\d{1,2})歳\s*\/\s*([\d.]+)kg/.exec(profile.replace(/\s+/g, ''));

      entrants.push({
        // 艇番はこの時点では仮。全部読み終わってから確定させる。
        slotCode: detectLaneNumber($, $tb) ?? '',
        numberLabel: '',
        name: extractRacerName($, $tb),
        meta: {
          racerId: regMatch[1],
          racerClass: regMatch[2],
          branch: place?.[1],
          hometown: place?.[2],
          age: body?.[1],
          weight: body?.[2],
          avgSt,
          nationalWin: national[0],
          nationalTop2: national[1],
          nationalTop3: national[2],
          localWin: local[0],
          localTop2: local[1],
          localTop3: local[2],
          motorNo: motorCell.find((s) => /^\d+$/.test(s)),
          motorTop2: motor[0],
          motorTop3: motor[1],
          boatNo: boatCell.find((s) => /^\d+$/.test(s)),
          boatTop2: boat[0],
          boatTop3: boat[1],
          // 旧表示との互換。先頭が全国勝率になるようにしてある。
          rates: [...national, ...local, ...motor, ...boat],
        },
        sortOrder: 0,
      });
    });

    if (entrants.length === 0) {
      console.warn(`[boatrace] ${externalKey}: 出走表を1件も取得できませんでした`);
      return [];
    }

    // 艇番の確定。
    //
    // HTMLから読んだ艇番が「6艇ぶんすべて異なる」ときだけそれを信用する。
    // 重複や欠けがある場合は、公式サイトが必ず1号艇→6号艇の順に並べることを
    // 利用して、出てきた順番で 1,2,3... と振り直す。
    //
    // 以前はここで重複した艇番のまま保存しようとして、
    // データベースに弾かれて出走表がまったく入らなかった。
    const detected = entrants.map((e) => e.slotCode);
    const allValid =
      detected.every((s) => /^[1-6]$/.test(s)) &&
      new Set(detected).size === detected.length;

    if (!allValid) {
      console.warn(
        `[boatrace] ${externalKey}: 艇番を読めなかったので並び順で振り直します ` +
          `(読めた値: ${JSON.stringify(detected)})`,
      );
    }

    const fixed = entrants.map((e, i) => {
      const slot = allValid ? e.slotCode : String(i + 1);
      return {
        ...e,
        slotCode: slot,
        numberLabel: `${slot}号艇`,
        name: e.name || `${slot}号艇`,
        sortOrder: Number(slot),
      };
    });

    // 念のため、それでも重複していたら先勝ちで落とす。
    // 重複があるとデータベースへの書き込み全体が失敗してしまうため。
    const seen = new Set<string>();
    const unique = fixed.filter((e) => {
      if (seen.has(e.slotCode)) return false;
      seen.add(e.slotCode);
      return true;
    });

  return unique.sort((a, b) => a.sortOrder - b.sortOrder);
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

/**
 * セルの中身を <br> で分けて、行ごとの文字列にする。
 *
 * 公式の出走表は1つのセルに「モーターNo / 2連率 / 3連率」を縦に並べている。
 * cheerio の .text() は <br> を無視して繋げてしまうため、
 * 「53」と「33.95」が「5333.95」になり桁が壊れる。
 * HTMLの段階で切ってから中のタグを落とす。
 */
function splitByBr(html: string | null): string[] {
  if (!html) return [];
  return html
    .split(/<br\s*\/?>/i)
    .map((chunk) => cleanText(chunk.replace(/<[^>]*>/g, ' ')))
    .filter((s) => s.length > 0);
}

/** 全角数字を半角に直す */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 選手ブロックから艇番(1-6)を拾う。
 *
 * 公式サイトの「枠」欄は全角数字（１〜６）で書かれている。
 * 以前は半角しか見ていなかったため艇番をまったく読めず、
 * 代わりに今節成績の数字を拾って6艇とも同じ番号になっていた。
 */
function detectLaneNumber($: cheerio.CheerioAPI, $tb: cheerio.Cheerio<any>): string | null {
  // クラス名 is-boatColor1 などが最も確実
  const cls = $tb.find('[class*="boatColor"]').first().attr('class') ?? '';
  const byClass = /boatColor([1-6])/.exec(cls);
  if (byClass) return byClass[1]!;

  let lane: string | null = null;
  $tb.find('td').each((_, td) => {
    if (lane) return;
    const t = toHalfWidthDigits(cleanText($(td).text()));
    if (/^[1-6]$/.test(t)) lane = t;
  });
  return lane;
}

/**
 * 選手名。
 *
 * 選手ページへのリンクは1つの選手ブロックに2つある。
 * 先に出てくるのは顔写真のリンクで、中身が画像なのでテキストは空。
 * 以前は .first() でこちらを拾ってしまい、名前がずっと空だった。
 * 文字が入っているリンクを選ぶ。
 */
function extractRacerName($: cheerio.CheerioAPI, $tb: cheerio.Cheerio<any>): string {
  let name = '';
  $tb.find('a[href*="racersearch"]').each((_, a) => {
    if (name) return;
    const t = cleanText($(a).text());
    if (t && !/^\d+$/.test(t)) name = t;
  });
  if (name) return name;

  const m = /([一-龥゠-ヿ]{1,5}[\s　]+[一-龥゠-ヿ]{1,5})/.exec(cleanText($tb.text()));
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
