/**
 * 今日のお題レースを決める。
 *
 * 【選び方】
 *   ① 締切が夜（19:00〜21:00）のレースを候補にする。みんなが集まりやすい時間。
 *   ② その中でグレードが高いものを優先（SG > PG1 > G1 > G2 > G3 > 一般）。
 *   ③ 同じグレードなら、遅いほうを選ぶ（優勝戦・メインレースになりやすい）。
 *   ④ 夜のレースが1つもない日は、その日の最後のレースにする。
 *
 * 一度決めたら変えない。朝に決めて1日そのまま。
 */

import { db } from '../db.ts';

const GRADE_RANK: Record<string, number> = {
  SG: 5,
  PG1: 4,
  G1: 3,
  G2: 2,
  G3: 1,
};

/** JSTの「今日」 */
function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** その時刻のJSTでの「時」 */
function hourJst(iso: string): number {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).getUTCHours();
}

export async function pickDailyFeature(dateIso = todayJst(), force = false) {
  const supabase = db();

  const { data: existing } = await supabase
    .from('daily_features')
    .select('event_id')
    .eq('race_date', dateIso)
    .maybeSingle();

  if (existing && !force) {
    console.log(`[feature] ${dateIso}: すでに決まっています`);
    return existing.event_id as string;
  }

  const ymd = dateIso.replace(/-/g, '');
  const { data: events, error } = await supabase
    .from('events')
    .select('id, title, grade, race_number, deadline_at, status')
    .like('external_key', `boatrace:${ymd}:%`)
    .eq('status', 'scheduled')
    .order('deadline_at', { ascending: true });
  if (error) throw error;

  // 締切まで30分以上あるものだけ（決めた直後に締まっては意味がない）
  const limit = Date.now() + 30 * 60 * 1000;
  const usable = (events ?? []).filter(
    (e: any) => new Date(e.deadline_at).getTime() > limit,
  );

  if (usable.length === 0) {
    console.warn(`[feature] ${dateIso}: 候補になるレースがありません`);
    return null;
  }

  const night = usable.filter((e: any) => {
    const h = hourJst(e.deadline_at);
    return h >= 19 && h < 21;
  });

  const pool = night.length > 0 ? night : usable;

  const best = [...pool].sort((a: any, b: any) => {
    const g = (GRADE_RANK[b.grade ?? ''] ?? 0) - (GRADE_RANK[a.grade ?? ''] ?? 0);
    if (g !== 0) return g;
    return new Date(b.deadline_at).getTime() - new Date(a.deadline_at).getTime();
  })[0];

  const { error: e2 } = await supabase.from('daily_features').upsert(
    {
      race_date: dateIso,
      event_id: best.id,
      multiplier: 2.0,
      max_stake: 5000,
    },
    { onConflict: 'race_date' },
  );
  if (e2) throw e2;

  console.log(
    `[feature] ${dateIso}: ${best.title}（締切 ${best.deadline_at}）をお題にしました`,
  );
  return best.id as string;
}
