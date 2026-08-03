/**
 * オッズ取得API。
 *
 * 全レースのオッズを定期取得すると公式サイトへのアクセスが桁違いに増えるので、
 * 「誰かがそのレースを開いたとき」だけ取りに行き、90秒キャッシュする。
 * 締切後は値が変わらないので、キャッシュがあれば二度と取りに行かない。
 *
 * ?debug=1 を付けると、読み取りのどこで失敗しているかを返す。
 */

import { NextResponse } from 'next/server';
import { parseOddsPage, diagnoseOddsPage } from '@/core/oddspage';
import { ODDS_PAGE, parseBoatraceEventKey } from '@/core';
import { supabaseServer } from '@/lib/supabase';

/**
 * 公式サイトのページは1枚あたり10秒近くかかることがある。
 * Vercel の関数は何も指定しないと10秒で打ち切られる。
 */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** キャッシュの有効期間 */
const TTL_MS = 90_000;

/** 公式サイトを待つ上限 */
const FETCH_TIMEOUT_MS = 25_000;

const USER_AGENT =
  process.env.INGEST_USER_AGENT ??
  'NoMoneyBoat/0.1 (hobby fan site; +https://nomoney-boat-web.vercel.app/about)';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const url0 = new URL(request.url);
  const betType = url0.searchParams.get('bt') ?? 'trifecta';
  const debug = url0.searchParams.get('debug') === '1';
  // 「更新」ボタンから来たときは、90秒キャッシュを飛ばして取り直す
  const forceFresh = url0.searchParams.get('fresh') === '1';

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
    !debug &&
    cached &&
    // 締切後は値が変わらないので、更新ボタンでも取り直す必要はない
    (closed ||
      (!forceFresh && Date.now() - new Date(cached.fetched_at).getTime() < TTL_MS));

  if (fresh) {
    return NextResponse.json({
      odds: cached.odds,
      updatedAt: cached.source_updated_at,
      cached: true,
    });
  }

  try {
    const { dateYmd, venueCode, raceNo } = parseBoatraceEventKey(event.external_key);
    const url =
      `https://www.boatrace.jp/owpc/pc/race/${page}` +
      `?rno=${raceNo}&jcd=${venueCode}&hd=${dateYmd}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();

    if (debug) return NextResponse.json(diagnoseOddsPage(html, betType, url));

    const { odds, updatedAt } = parseOddsPage(html, betType);

    if (Object.keys(odds).length === 0) {
      return NextResponse.json({
        odds: {},
        updatedAt,
        detail: html.includes('オッズ')
          ? 'ページは取得できましたが、オッズがまだ入っていません'
          : 'ページの形が想定と違います',
      });
    }

    await supabase.rpc('upsert_market_odds', {
      p_event_id: eventId,
      p_bet_type_code: betType,
      p_odds: odds,
      p_source_updated_at: updatedAt,
    });

    return NextResponse.json({ odds, updatedAt, cached: false });
  } catch (err: any) {
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
    return NextResponse.json({
      odds: {},
      error: err?.message ?? String(err),
    });
  }
}
