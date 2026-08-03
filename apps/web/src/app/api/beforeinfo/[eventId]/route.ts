/**
 * 直前情報の取得API。
 *
 * オッズと同じ考え方。全レースを定期的に取ると公式サイトへの負担が大きいので、
 * 「誰かがそのレースを開いたとき」だけ取りに行き、結果を events.meta に
 * 貯めて90秒使い回す。締切後は値が変わらないのでずっと使い回す。
 */

import { NextResponse } from 'next/server';
import { parseBeforeInfo } from '@/core/beforeinfo';
import { parseBoatraceEventKey } from '@/core';
import { supabaseServer } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const TTL_MS = 90_000;
const FETCH_TIMEOUT_MS = 25_000;

const USER_AGENT =
  process.env.INGEST_USER_AGENT ??
  'NoMoneyBoat/0.1 (hobby fan site; +https://nomoney-boat-web.vercel.app/about)';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: event } = await supabase
    .from('events')
    .select('id, external_key, deadline_at, meta')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const cached = (event.meta as any)?.beforeInfo;
  const closed = new Date(event.deadline_at).getTime() <= Date.now();
  if (
    cached?.fetchedAt &&
    (closed || Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS)
  ) {
    return NextResponse.json({ info: cached.info, cached: true });
  }

  try {
    const { dateYmd, venueCode, raceNo } = parseBoatraceEventKey(event.external_key);
    const url =
      'https://www.boatrace.jp/owpc/pc/race/beforeinfo' +
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

    const info = parseBeforeInfo(await res.text());
    if (!info) {
      return NextResponse.json({ info: null, detail: 'まだ直前情報が出ていません' });
    }

    // 保存はできなくても表示はしたいので、失敗しても無視する
    const admin = supabaseAdmin();
    if (admin) {
      await admin
        .from('events')
        .update({
          meta: {
            ...((event.meta as any) ?? {}),
            beforeInfo: { info, fetchedAt: new Date().toISOString() },
          },
        })
        .eq('id', eventId);
    }

    return NextResponse.json({ info, cached: false });
  } catch (err: any) {
    if (cached?.info) {
      return NextResponse.json({ info: cached.info, cached: true, stale: true });
    }
    return NextResponse.json({
      info: null,
      error: err?.message ?? String(err),
    });
  }
}
