/**
 * オッズ取得API。
 *
 * 全レースのオッズを定期取得すると公式サイトへのアクセスが桁違いに増えるので、
 * 「誰かがそのレースを開いたとき」だけ取りに行き、90秒キャッシュする。
 * 友達数人で遊ぶ規模なら、1レースあたり数回のアクセスで済む。
 *
 * 締切後は値が変わらないので、キャッシュがあれば二度と取りに行かない。
 */

import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import {
  ODDS_PAGE,
  parseTrifectaOdds,
  parseTrioOdds,
  parsePairOdds,
  parseWinOdds,
  parsePlaceOdds,
  parseBoatraceEventKey,
  type OddsMap,
  type Row,
} from '@/core';
import { supabaseServer } from '@/lib/supabase';

/** キャッシュの有効期間 */
const TTL_MS = 90_000;

const USER_AGENT =
  process.env.INGEST_USER_AGENT ??
  'NoMoneyBoat/0.1 (hobby fan site; +https://example.com/about)';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const betType = new URL(request.url).searchParams.get('bt') ?? 'trifecta';

  const page = ODDS_PAGE[betType];
  if (!page) return NextResponse.json({ error: 'unknown bet type' }, { status: 400 });

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: event } = await supabase
    .from('events')
    .select('id, external_key, deadline_at, status')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // キャッシュを見る
  const { data: cached } = await supabase
    .from('market_odds')
    .select('odds, source_updated_at, fetched_at')
    .eq('event_id', eventId)
    .eq('bet_type_code', betType)
    .maybeSingle();

  const closed = new Date(event.deadline_at).getTime() <= Date.now();
  const fresh =
    cached && (closed || Date.now() - new Date(cached.fetched_at).getTime() < TTL_MS);

  if (fresh) {
    return NextResponse.json({
      odds: cached.odds,
      updatedAt: cached.source_updated_at,
      cached: true,
    });
  }

  // 取りに行く
  try {
    const { dateYmd, venueCode, raceNo } = parseBoatraceEventKey(event.external_key);
    const url =
      `https://www.boatrace.jp/owpc/pc/race/${page}` +
      `?rno=${raceNo}&jcd=${venueCode}&hd=${dateYmd}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ja' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const { odds, updatedAt } = parseOddsPage(html, betType);

    if (Object.keys(odds).length > 0) {
      await supabase.rpc('upsert_market_odds', {
        p_event_id: eventId,
        p_bet_type_code: betType,
        p_odds: odds,
        p_source_updated_at: updatedAt,
      });
    }

    return NextResponse.json({ odds, updatedAt, cached: false });
  } catch (err) {
    console.error('[odds] 取得失敗', err);
    // 取れなかったら古いキャッシュでも返す。
    // オッズは目安なので、少し古くても「何も出ない」よりは役に立つ。
    if (cached) {
      return NextResponse.json({
        odds: cached.odds,
        updatedAt: cached.source_updated_at,
        cached: true,
        stale: true,
      });
    }
    return NextResponse.json({ odds: {}, error: 'fetch failed' });
  }
}

/** ページ全体からオッズ表を見つけて解析する */
function parseOddsPage(
  html: string,
  betType: string,
): { odds: OddsMap; updatedAt: string | null } {
  const $ = cheerio.load(html);

  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const updatedAt =
    /オッズ更新時間\s*(\d{1,2}:\d{2})/.exec(bodyText)?.[1] ??
    (/締切時オッズ/.test(bodyText) ? '締切時' : null);

  // 「2連単・2連複」のように1ページに複数の表があるため、見出しで絞り込む
  const rows = collectRows($, HEADINGS[betType]);

  switch (betType) {
    case 'trifecta':
      return { odds: parseTrifectaOdds(rows), updatedAt };
    case 'trio':
      return { odds: parseTrioOdds(rows), updatedAt };
    case 'exacta':
      return { odds: parsePairOdds(rows, true), updatedAt };
    case 'quinella':
      return { odds: parsePairOdds(rows, false), updatedAt };
    case 'win':
      return { odds: parseWinOdds(rows), updatedAt };
    case 'place':
      return { odds: parsePlaceOdds(rows), updatedAt };
    default:
      return { odds: {}, updatedAt };
  }
}

/** 賭け式 → ページ内の見出し文字列 */
const HEADINGS: Record<string, string> = {
  trifecta: '3連単オッズ',
  trio: '3連複オッズ',
  exacta: '2連単オッズ',
  quinella: '2連複オッズ',
  win: '単勝オッズ',
  place: '複勝オッズ',
};

/**
 * 指定した見出しの直後にある表を、行×セルの配列にする。
 * 見出しが見つからなければ、ページ内で最も行数の多い表を使う。
 */
function collectRows($: cheerio.CheerioAPI, heading: string | undefined): Row[] {
  const toRows = (table: cheerio.Cheerio<any>): Row[] =>
    table
      .find('tr')
      .map((_, tr) =>
        $(tr)
          .find('td, th')
          .map((__, cell) => $(cell).text().replace(/ /g, ' ').trim())
          .get(),
      )
      .get() as unknown as Row[];

  if (heading) {
    let found: Row[] | null = null;
    $('h2, h3, h4, caption').each((_, el) => {
      if (found) return;
      if (!$(el).text().includes(heading)) return;
      const table = $(el).nextAll('table').first();
      if (table.length) found = toRows(table);
    });
    if (found) return found;
  }

  let best: Row[] = [];
  $('table').each((_, t) => {
    const rows = toRows($(t));
    if (rows.length > best.length) best = rows;
  });
  return best;
}
