/**
 * 「更新」ボタンの中身。
 *
 * 15分ごとの自動処理を待たずに、そのレースだけをその場で精算する。
 * 押した人にしか影響しない操作ではないが、やることは自動処理と同じで、
 * 何度押しても結果は変わらない（台帳の二重計上はデータベース側で防いでいる）。
 *
 * 返す status:
 *   'settled'   精算した
 *   'already'   すでに精算済み
 *   'too_early' まだ締切前
 *   'pending'   締切済みだが公式サイトにまだ結果が出ていない
 *   'cancelled' 中止
 *   'no_admin'  管理用の鍵が設定されていない
 */

import { NextResponse } from 'next/server';
import { parseRaceResult } from '@/core/raceresult';
import { settleEvent } from '@/core/settle';
import { parseBoatraceEventKey } from '@/core';
import { supabaseServer } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 25_000;

const USER_AGENT =
  process.env.INGEST_USER_AGENT ??
  'NoMoneyBoat/0.1 (hobby fan site; +https://nomoney-boat-web.vercel.app/about)';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  // ログインしている人だけが押せる
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ status: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  if (!admin) {
    return NextResponse.json({
      status: 'no_admin',
      message: '管理用の鍵が設定されていません（Vercelの環境変数を確認してください）',
    });
  }

  const { data: event } = await admin
    .from('events')
    .select('id, external_key, deadline_at, status')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ status: 'not_found' }, { status: 404 });

  if (event.status === 'resolved') {
    return NextResponse.json({ status: 'already' });
  }
  if (event.status === 'cancelled') {
    return NextResponse.json({ status: 'cancelled' });
  }

  const deadline = new Date(event.deadline_at).getTime();
  if (deadline > Date.now()) {
    return NextResponse.json({ status: 'too_early' });
  }

  // 締切を過ぎているのに開いたままなら、まず閉じる。
  // （自動処理の close がまだ回っていない場合の取りこぼしを防ぐ）
  if (event.status === 'scheduled') {
    await admin
      .from('markets')
      .update({ status: 'closed' })
      .eq('event_id', eventId)
      .eq('status', 'open');
    await admin.from('events').update({ status: 'closed' }).eq('id', eventId);
  }

  try {
    const { dateYmd, venueCode, raceNo } = parseBoatraceEventKey(event.external_key);
    const url =
      'https://www.boatrace.jp/owpc/pc/race/raceresult' +
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

    const result = parseRaceResult(await res.text());

    if (!result) {
      return NextResponse.json({
        status: 'pending',
        message: '公式サイトにまだ結果が出ていません',
      });
    }

    if (result.status === 'cancelled') {
      return NextResponse.json({
        status: 'cancelled',
        message: '中止のため、返還処理を待っています',
      });
    }

    const summary = await settleEvent(admin, eventId, result);
    await admin.rpc('refresh_user_season_stats');

    return NextResponse.json({ status: 'settled', ...summary });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : '取得に失敗しました',
    });
  }
}
