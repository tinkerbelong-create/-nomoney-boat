/**
 * 出走表の詳しい数字（勝率・当地・モーター・平均ST）を取るAPI。
 *
 * これらは公式のレースごとの出走表ページにしか載っていない。
 * 全144レース分を先回りして取ると30分かかるので、
 * オッズや直前情報と同じく「開いたときだけ」取りに行き、
 * 取れたぶんはデータベースに残して次からは即表示する。
 */

import { NextResponse } from 'next/server';
import { parseEntrants } from '@/core/racelist';
import { parseBoatraceEventKey } from '@/core';
import { supabaseServer } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

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
    .select('id, external_key, event_entrants(slot_code, name, meta)')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // すでに詳しい数字が入っていれば、それをそのまま返す
  const current = (event.event_entrants ?? []) as any[];
  if (current.length > 0 && current.some((e) => e.meta?.nationalWin)) {
    return NextResponse.json({
      entrants: current
        .map((e) => ({ slotCode: e.slot_code, name: e.name, meta: e.meta }))
        .sort((a, b) => Number(a.slotCode) - Number(b.slotCode)),
      cached: true,
    });
  }

  try {
    const { dateYmd, venueCode, raceNo } = parseBoatraceEventKey(event.external_key);
    const url =
      'https://www.boatrace.jp/owpc/pc/race/racelist' +
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

    const list = parseEntrants(await res.text(), event.external_key);
    if (list.length === 0) {
      return NextResponse.json({ entrants: [], detail: '出走表をまだ取得できません' });
    }

    // 取れたら保存しておく（失敗しても表示はする）
    const admin = supabaseAdmin();
    if (admin) {
      await admin.from('event_entrants').upsert(
        list.map((x) => ({
          event_id: eventId,
          slot_code: x.slotCode,
          number_label: x.numberLabel,
          name: x.name,
          meta: x.meta,
          sort_order: x.sortOrder,
        })),
        { onConflict: 'event_id,slot_code' },
      );
    }

    return NextResponse.json({
      entrants: list.map((x) => ({ slotCode: x.slotCode, name: x.name, meta: x.meta })),
      cached: false,
    });
  } catch (err: any) {
    return NextResponse.json({ entrants: [], error: err?.message ?? String(err) });
  }
}
