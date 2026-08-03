/**
 * 直前情報（beforeinfo）の解析。
 *
 * 予想でいちばん見られるデータ。
 *   展示タイム / チルト / 調整体重 / 部品交換
 *   スタート展示（進入コースと展示ST）
 *   水面気象（気温・水温・風速・波高）
 *
 * レース直前にならないと出ないので、取り込みワーカーで先回りせず、
 * 利用者がそのレースを開いたときにオッズと同じ要領で取りに行く。
 *
 * cheerio を使うのでサーバー専用。core/index.ts からは再輸出しないこと。
 */

import * as cheerio from 'cheerio';

export interface BeforeRacer {
  /** 艇番 */
  slot: string;
  name: string;
  /** 調整重量込みの体重 */
  weight?: string;
  /** 展示タイム。小さいほど速い */
  exhibitionTime?: string;
  tilt?: string;
  propeller?: string;
  parts?: string;
}

export interface StartExhibition {
  /** 進入コース（1が最内） */
  course: number;
  /** その コースに入った艇番 */
  slot: string;
  /** 展示ST。'.17' など。F はフライング */
  st: string;
}

export interface BeforeInfo {
  racers: BeforeRacer[];
  start: StartExhibition[];
  weather: {
    airTemp?: string;
    waterTemp?: string;
    windSpeed?: string;
    waveHeight?: string;
    condition?: string;
  };
  /** 「5R時点」のような但し書き */
  weatherAt?: string;
}

function cleanText(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 直前情報を読む。まだ何も出ていなければ null。
 */
export function parseBeforeInfo(html: string): BeforeInfo | null {
  const $ = cheerio.load(html);
  const bodyText = cleanText($('body').text());

  if (/データがありません/.test(bodyText)) return null;

  const racers = parseRacers($);
  const start = parseStartExhibition($);
  const weather = parseWeather(bodyText);

  // 展示タイムもスタート展示も無いなら、まだ直前情報は出ていない
  const hasAny =
    racers.some((r) => r.exhibitionTime) || start.length > 0 || weather.airTemp;
  if (!hasAny) return null;

  return {
    racers,
    start,
    weather,
    weatherAt: /水面気象情報\s*(\d{1,2}R時点)/.exec(bodyText)?.[1],
  };
}

/**
 * 選手ごとの行。
 *
 * 1行目のセルの並びは
 *   枠 / 写真 / 選手名 / 体重 / 展示タイム / チルト / プロペラ / 部品交換 / ...
 * 体重のセル（「52.0kg」）を目印にして、そこから右へ数える。
 */
function parseRacers($: cheerio.CheerioAPI): BeforeRacer[] {
  const out: BeforeRacer[] = [];

  $('table tbody').each((_, tbody) => {
    const $tb = $(tbody);

    const link = findRacerLink($, $tb);
    if (!link) return;

    const tds = $tb
      .find('tr')
      .first()
      .find('td')
      .map((__, td) => cleanText($(td).text()))
      .get();
    if (tds.length === 0) return;

    const slot =
      toHalfWidthDigits(tds[0] ?? '').match(/^[1-6]$/)?.[0] ??
      /boatColor([1-6])/.exec($tb.find('[class*="boatColor"]').first().attr('class') ?? '')?.[1];
    if (!slot) return;
    if (out.some((r) => r.slot === slot)) return;

    const wIdx = tds.findIndex((t) => /^\d{2}\.\d\s*kg$/.test(t.replace(/\s/g, '')));
    const at = (i: number) => (i >= 0 ? tds[i] : undefined);

    out.push({
      slot,
      name: link,
      weight: at(wIdx),
      exhibitionTime: pick(at(wIdx + 1), /^\d\.\d{2}$/),
      tilt: pick(at(wIdx + 2), /^-?\d\.\d$/),
      propeller: at(wIdx + 3) || undefined,
      parts: at(wIdx + 4) || undefined,
    });
  });

  return out.sort((a, b) => Number(a.slot) - Number(b.slot));
}

function pick(v: string | undefined, re: RegExp): string | undefined {
  return v && re.test(v) ? v : undefined;
}

/** 顔写真のリンクは中身が画像でテキストが空なので、文字が入っているほうを選ぶ */
function findRacerLink($: cheerio.CheerioAPI, $tb: cheerio.Cheerio<any>): string | undefined {
  let name: string | undefined;
  $tb.find('a[href*="racersearch"]').each((_, a) => {
    if (name) return;
    const t = cleanText($(a).text());
    if (t && !/^\d+$/.test(t)) name = t;
  });
  return name;
}

/**
 * スタート展示。
 *
 * 「コース番号 / 艇番の画像 / 展示ST」が1行ずつ並ぶ。
 * 艇番は画像のファイル名（img_boat2_3.png のような形）にしか入っていないので
 * そこから拾う。行の並びがそのまま進入コースになる。
 */
function parseStartExhibition($: cheerio.CheerioAPI): StartExhibition[] {
  const out: StartExhibition[] = [];

  $('table').each((_, table) => {
    if (out.length > 0) return;
    const $t = $(table);
    if (!/スタート展示/.test(cleanText($t.text()))) return;

    $t.find('tr').each((__, tr) => {
      const $tr = $(tr);
      const img = $tr.find('img[src*="img_boat"]').first().attr('src') ?? '';
      const slot = /img_boat\d*_([1-6])/.exec(img)?.[1];
      if (!slot) return;

      const text = cleanText($tr.text());
      const st = /(F?\s*\.\d{2})/.exec(text)?.[1]?.replace(/\s/g, '');
      out.push({ course: out.length + 1, slot, st: st ?? '' });
    });
  });

  return out;
}

function parseWeather(bodyText: string) {
  const pickRe = (re: RegExp) => re.exec(bodyText)?.[1];
  return {
    airTemp: pickRe(/気温\s*([\d.]+)℃/),
    waterTemp: pickRe(/水温\s*([\d.]+)℃/),
    windSpeed: pickRe(/風速\s*([\d.]+)m/),
    waveHeight: pickRe(/波高\s*([\d.]+)cm/),
    condition: pickRe(/℃\s*(晴|曇り|曇|雨|雪|霧)/),
  };
}
