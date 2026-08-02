/**
 * 開催スケジュールと出走表の取り込み。
 */

import { db } from '../db.ts';
import { BoatraceAdapter } from '../adapters/boatrace.ts';
import type { SportAdapter } from '../types.ts';

const adapters: Record<string, SportAdapter> = {
  boatrace: new BoatraceAdapter(),
};

export function getAdapter(sportCode: string): SportAdapter {
  const a = adapters[sportCode];
  if (!a) throw new Error(`adapter not found: ${sportCode}`);
  return a;
}

/** 'YYYYMMDD'（JST） */
export function todayYmd(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * イベントとマーケットを取り込む。
 * 既存イベントは upsert なので、締切時刻の変更や中止も追従する。
 */
export async function syncSchedule(dateYmd: string, sportCode = 'boatrace') {
  const adapter = getAdapter(sportCode);
  const drafts = await adapter.fetchSchedule(dateYmd);
  if (drafts.length === 0) {
    console.log(`[sync] ${dateYmd}: 開催なし`);
    return { events: 0, markets: 0 };
  }

  const supabase = db();

  const { data: events, error } = await supabase
    .from('events')
    .upsert(
      drafts.map((d) => ({
        sport_code: sportCode,
        external_key: d.externalKey,
        title: d.title,
        venue_code: d.venueCode,
        venue_name: d.venueName,
        race_number: d.raceNumber,
        grade: d.grade ?? null,
        scheduled_at: d.scheduledAt.toISOString(),
        deadline_at: d.deadlineAt.toISOString(),
        status: d.status,
        meta: d.meta ?? {},
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'sport_code,external_key' },
    )
    .select('id, external_key, deadline_at, status');

  if (error) throw error;

  type EventRow = { id: string; external_key: string; deadline_at: string; status: string };
  const byKey = new Map<string, EventRow>(
    ((events ?? []) as EventRow[]).map((e) => [e.external_key, e]),
  );

  // マーケットを開く。締切時刻はイベントに追従させる。
  const marketRows = drafts.flatMap((d) => {
    const ev = byKey.get(d.externalKey);
    if (!ev) return [];
    return d.betTypeCodes.map((code) => ({
      event_id: ev.id,
      sport_code: sportCode,
      bet_type_code: code,
      settlement_mode: 'official',
      closes_at: d.deadlineAt.toISOString(),
      status: d.status === 'cancelled' ? 'void' : 'open',
    }));
  });

  const { error: mErr } = await supabase
    .from('markets')
    .upsert(marketRows, { onConflict: 'event_id,bet_type_code', ignoreDuplicates: false });
  if (mErr) throw mErr;

  // 中止になったレースは、その場で全投票を返還する
  for (const d of drafts.filter((x) => x.status === 'cancelled')) {
    const ev = byKey.get(d.externalKey);
    if (ev) await refundEvent(ev.id, 'レース中止');
  }

  console.log(`[sync] ${dateYmd}: ${drafts.length}レース / ${marketRows.length}マーケット`);
  return { events: drafts.length, markets: marketRows.length };
}

/**
 * 出走表を取り込む。未取得のイベントだけを対象にして無駄なアクセスを避ける。
 *
 * force を立てると、すでに取り込み済みのレースも取り直す。
 * 読み取りの不具合を直したあとに、間違ったまま入っているデータを
 * 上書きするために使う。
 */
export async function syncEntrants(dateYmd: string, sportCode = 'boatrace', force = false) {
  const supabase = db();
  const adapter = getAdapter(sportCode);

  const { data: events, error } = await supabase
    .from('events')
    .select('id, external_key, event_entrants(id)')
    .eq('sport_code', sportCode)
    .like('external_key', `${sportCode}:${dateYmd}:%`)
    .eq('status', 'scheduled');
  if (error) throw error;

  const targets = force
    ? (events ?? [])
    : (events ?? []).filter((e: any) => (e.event_entrants?.length ?? 0) === 0);
  console.log(`[entrants] 対象 ${targets.length} / 全 ${events?.length ?? 0} レース`);
  if (targets.length === 0) return 0;

  // 場ごとにまとめる。レース一覧ページ1枚に12レース分の出走メンバーが
  // 載っているので、場の数だけアクセスすれば足りる。
  // （以前はレースごとに出走表ページを開いていて、144アクセス・30分かかっていた）
  const byVenue = new Map<string, { id: string; raceNo: number; key: string }[]>();
  for (const ev of targets) {
    const parts = String(ev.external_key).split(':'); // boatrace:YYYYMMDD:jcd:rno
    const jcd = parts[2];
    const raceNo = Number(parts[3]);
    if (!jcd || !Number.isFinite(raceNo)) continue;
    if (!byVenue.has(jcd)) byVenue.set(jcd, []);
    byVenue.get(jcd)!.push({ id: ev.id, raceNo, key: ev.external_key });
  }

  let ok = 0;
  for (const [jcd, races] of byVenue) {
    try {
      const map = await (adapter as any).fetchVenueEntrants(dateYmd, jcd);
      if (!map || map.size === 0) {
        console.warn(`[entrants] jcd=${jcd}: 出走メンバーを取得できませんでした`);
        continue;
      }

      for (const race of races) {
        const list = map.get(race.raceNo);
        if (!list || list.length === 0) continue;

        const { error: e2 } = await supabase.from('event_entrants').upsert(
          list.map((x: any) => ({
            event_id: race.id,
            slot_code: x.slotCode,
            number_label: x.numberLabel,
            name: x.name,
            meta: x.meta,
            sort_order: x.sortOrder,
          })),
          { onConflict: 'event_id,slot_code' },
        );
        if (e2) {
          console.error(`[entrants] ${race.key} 保存失敗:`, e2);
          continue;
        }
        ok += 1;
      }
      console.log(`[entrants] jcd=${jcd}: ${races.length} レース分を反映`);
    } catch (err) {
      console.error(`[entrants] jcd=${jcd} 失敗:`, err);
    }
  }

  console.log(`[entrants] ${ok} レース取り込み`);
  return ok;
}

/**
 * 出走表の詳細（全国勝率・当地勝率・モーター2連率など）を埋める。
 *
 * これらはレースごとの出走表ページにしか載っていない。
 * 全144レース分を一度に取ると30分かかってしまうので、
 * 15分ごとのジョブで「締切が近い順に少しずつ」取る。
 * 利用者が実際に見るのはこれから始まるレースなので、これで十分間に合う。
 */
export async function syncEntrantDetails(limit = 15, sportCode = 'boatrace') {
  const supabase = db();
  const adapter = getAdapter(sportCode);

  const { data: events, error } = await supabase
    .from('events')
    .select('id, external_key, deadline_at, event_entrants(slot_code, meta)')
    .eq('sport_code', sportCode)
    .eq('status', 'scheduled')
    .gt('deadline_at', new Date().toISOString())
    .order('deadline_at', { ascending: true })
    .limit(200);
  if (error) throw error;

  const targets = (events ?? [])
    .filter((e: any) => {
      const list = e.event_entrants ?? [];
      if (list.length === 0) return false; // まず名前が入っていないと意味がない
      return !list.some((x: any) => x.meta?.nationalWin);
    })
    .slice(0, limit);

  console.log(`[details] 対象 ${targets.length} レース`);

  let ok = 0;
  for (const ev of targets) {
    try {
      const list = await adapter.fetchEntrants(ev.external_key);
      if (list.length === 0) continue;

      const { error: e2 } = await supabase.from('event_entrants').upsert(
        list.map((x) => ({
          event_id: ev.id,
          slot_code: x.slotCode,
          number_label: x.numberLabel,
          name: x.name,
          meta: x.meta,
          sort_order: x.sortOrder,
        })),
        { onConflict: 'event_id,slot_code' },
      );
      if (e2) throw e2;
      ok += 1;
    } catch (err) {
      console.error(`[details] ${ev.external_key} 失敗:`, err);
    }
  }

  console.log(`[details] ${ok} レース更新`);
  return ok;
}

/** 締切を過ぎたマーケットを閉じる。判定は必ずDBの now() で行う。 */
export async function closeExpiredMarkets() {
  const supabase = db();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('markets')
    .update({ status: 'closed' })
    .eq('status', 'open')
    .lte('closes_at', nowIso)
    .select('id');
  if (error) throw error;

  const { error: e2 } = await supabase
    .from('events')
    .update({ status: 'closed' })
    .eq('status', 'scheduled')
    .lte('deadline_at', nowIso);
  if (e2) throw e2;

  if (data && data.length > 0) console.log(`[close] ${data.length} マーケットを締切`);
  return data?.length ?? 0;
}

/** イベント配下の全投票を返還する */
export async function refundEvent(eventId: string, memo: string) {
  const supabase = db();

  const { data: markets } = await supabase.from('markets').select('id').eq('event_id', eventId);
  const marketIds = (markets ?? []).map((m) => m.id);
  if (marketIds.length === 0) return 0;

  const { data: bets } = await supabase
    .from('bets')
    .select('id, user_id, season_code, stake')
    .in('market_id', marketIds)
    .eq('status', 'placed');

  if (!bets || bets.length === 0) return 0;

  // 先に台帳へ。ref の一意制約があるので二重実行しても増えない。
  const { error: lErr } = await supabase.from('point_ledger').upsert(
    bets.map((b) => ({
      user_id: b.user_id,
      season_code: b.season_code,
      entry_type: 'refund',
      amount: b.stake,
      ref_type: 'bet',
      ref_id: b.id,
      memo,
    })),
    { onConflict: 'ref_type,ref_id,entry_type', ignoreDuplicates: true },
  );
  if (lErr) throw lErr;

  const { error: bErr } = await supabase
    .from('bets')
    .update({ status: 'refunded', payout: 0, settled_at: new Date().toISOString() })
    .in(
      'id',
      bets.map((b) => b.id),
    );
  if (bErr) throw bErr;

  await supabase.from('markets').update({ status: 'void' }).in('id', marketIds);

  console.log(`[refund] ${bets.length} 件を返還 (${memo})`);
  return bets.length;
}
