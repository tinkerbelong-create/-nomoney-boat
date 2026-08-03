import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase';

/** 現在のシーズンコード（JST） */
export function currentSeasonCode(): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 7);
}

export async function getMyProfile() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('id, handle, display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  return data;
}

/**
 * ログイン必須ページの入口。
 *
 * 未ログインならログイン画面へ、
 * ログイン済みだがプロフィール未作成ならオンボーディングへ送る。
 *
 * この区別が大事で、ひとまとめに /login へ送ってしまうと
 * 「登録は済んでいるのにログイン画面に戻され続ける」状態になる。
 */
export async function requireProfile() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, handle, display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) redirect('/onboarding');

  return profile;
}

/** 今シーズンの持ちポイント。台帳の積み上げで出す。 */
export async function getBalance(userId: string): Promise<number> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('current_balances')
    .select('balance')
    .eq('user_id', userId)
    .eq('season_code', currentSeasonCode())
    .maybeSingle();
  return Number(data?.balance ?? 0);
}

export type RankingMetric = 'profit' | 'roi' | 'hit';

export async function getRanking(metric: RankingMetric, seasonCode: string | null) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('friend_ranking', {
    p_season_code: seasonCode,
    p_metric: metric,
  });
  if (error) throw error;
  return data ?? [];
}

/** 当日のレース一覧。締切が近い順。 */
export async function getRacesForDate(dateYmd: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('events')
    .select('id, external_key, title, venue_code, venue_name, race_number, grade, deadline_at, status')
    .like('external_key', `boatrace:${dateYmd}:%`)
    .order('deadline_at', { ascending: true });
  return data ?? [];
}

export async function getEvent(eventId: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('events')
    .select(
      `id, external_key, title, venue_code, venue_name, race_number, grade,
       scheduled_at, deadline_at, status, meta,
       event_entrants(slot_code, number_label, name, meta, sort_order),
       markets(id, bet_type_code, status, closes_at, min_stake, stake_step),
       event_results(placings, refunded, weather, decided_by)`,
    )
    .eq('id', eventId)
    .maybeSingle();
  return data;
}

/** そのレースに対する自分の投票 */
export async function getMyBetsForEvent(eventId: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('bets')
    .select('id, selection, stake, status, payout, markets!inner(bet_type_code, event_id)')
    .eq('markets.event_id', eventId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

/** 確定した払戻金 */
export async function getMarketResults(marketIds: string[]) {
  if (marketIds.length === 0) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('market_results')
    .select('market_id, winning_selection, payout_per_100, popularity')
    .in('market_id', marketIds);
  return data ?? [];
}

export async function getTimeline(limit = 50) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('friend_timeline', { p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

export async function getMyBets(limit = 100) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('bets')
    .select(
      `id, selection, stake, status, payout, created_at, settled_at,
       markets!inner(bet_type_code, events!inner(id, title, venue_name, venue_code, race_number, deadline_at, status))`,
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getFriends() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { accepted: [], incoming: [], outgoing: [] };

  const { data } = await supabase
    .from('friendships')
    .select(
      `id, status, requester_id, addressee_id, created_at,
       requester:profiles!friendships_requester_id_fkey(id, handle, display_name, avatar_url),
       addressee:profiles!friendships_addressee_id_fkey(id, handle, display_name, avatar_url)`,
    );

  const rows = data ?? [];
  return {
    accepted: rows
      .filter((r: any) => r.status === 'accepted')
      .map((r: any) => (r.requester_id === user.id ? r.addressee : r.requester)),
    incoming: rows.filter((r: any) => r.status === 'pending' && r.addressee_id === user.id),
    outgoing: rows.filter((r: any) => r.status === 'pending' && r.requester_id === user.id),
  };
}

export interface StatRow {
  season_code: string;
  sport_code: string;
  bet_type_code: string;
  bet_count: number;
  hit_count: number;
  total_stake: number;
  total_payout: number;
  profit: number;
}

/**
 * 競技別・賭け式別の成績。
 *
 * 集計テーブルを直接読まず user_stats 関数を通す。
 * マテリアライズドビューには RLS をかけられないので、
 * 「自分かフレンドか」の判定を関数側で行っている。
 */
export async function getMyStats(
  userId: string,
  seasonCode: string | null,
): Promise<StatRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('user_stats', {
    p_user_id: userId,
    p_season_code: seasonCode,
  });
  // フレンドでない相手の成績を見ようとした場合はエラーになる
  if (error) return [];
  return (data ?? []) as StatRow[];
}

/** 月次推移（収支の折れ線用） */
export async function getMonthlyTrend(userId: string) {
  const data = await getMyStats(userId, null);

  const byMonth = new Map<string, number>();
  for (const r of data ?? []) {
    byMonth.set(r.season_code, (byMonth.get(r.season_code) ?? 0) + Number(r.profit));
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, profit]) => ({ month, profit }));
}

// =====================================================================
// お気に入り選手
// =====================================================================

export interface FavoriteRacer {
  racer_id: string;
  name: string;
  created_at: string;
}

/** 上限。データベース側のトリガーと同じ値。 */
export const FAVORITE_LIMIT = 10;

export async function getFavoriteRacers(): Promise<FavoriteRacer[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('favorite_racers')
    .select('racer_id, name, created_at')
    .order('created_at', { ascending: true });
  return data ?? [];
}

/**
 * 指定したレースのうち、お気に入り選手が出ているものを
 * イベントID → 選手名の配列 で返す。
 */
export async function getFavoriteEventMap(
  eventIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (eventIds.length === 0) return out;

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('my_favorite_events', {
    p_event_ids: eventIds,
  });
  if (error) return out;

  for (const row of data ?? []) {
    out.set((row as any).event_id, (row as any).racer_names ?? []);
  }
  return out;
}

/** 選手を名前か登録番号で探す */
export async function searchRacers(query: string) {
  const q = query.trim();
  if (q.length === 0) return [];

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('search_racers', {
    p_query: q,
    p_limit: 30,
  });
  if (error) return [];
  return (data ?? []) as {
    racer_id: string;
    name: string;
    racer_class: string | null;
    last_seen: string | null;
  }[];
}

/**
 * 1つの場の当日全レース（レース・結果一覧用）。
 * 確定していれば着順と3連単の払戻もいっしょに返す。
 */
export async function getVenueRaces(dateYmd: string, venueCode: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('events')
    .select(
      `id, title, venue_code, venue_name, race_number, grade, deadline_at, status,
       event_results(placings, decided_by),
       markets(bet_type_code, market_results(winning_selection, payout_per_100, popularity))`,
    )
    .like('external_key', `boatrace:${dateYmd}:${venueCode}:%`)
    .order('race_number', { ascending: true });
  return data ?? [];
}

/**
 * レース単位の成績（投票したレース数と、1点でも当たったレース数）。
 * 的中率は「点数」ではなく「レース」で数えるほうが感覚に合うため。
 */
export async function getRaceSummary(userId: string, seasonCode: string | null) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('user_race_summary', {
    p_user_id: userId,
    p_season_code: seasonCode,
  });
  if (error) return { race_count: 0, race_hit_count: 0 };
  const row = Array.isArray(data) ? data[0] : data;
  return {
    race_count: Number(row?.race_count ?? 0),
    race_hit_count: Number(row?.race_hit_count ?? 0),
  };
}

// =====================================================================
// 今日のお題レース
// =====================================================================

export interface DailyFeature {
  event_id: string;
  race_date: string;
  multiplier: number;
  max_stake: number;
  title: string;
  venue_name: string;
  venue_code: string;
  race_number: number;
  deadline_at: string;
  status: string;
  /** 自分がそのレースにすでに使ったポイント */
  my_stake: number;
}

/** 今日のお題レース。決まっていなければ null。 */
export async function getDailyFeature(): Promise<DailyFeature | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('today_feature');
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    ...row,
    multiplier: Number(row.multiplier),
    max_stake: Number(row.max_stake),
    my_stake: Number(row.my_stake ?? 0),
  } as DailyFeature;
}

/** そのレースがお題かどうか（レース画面用） */
export async function getFeatureForEvent(eventId: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('daily_features')
    .select('multiplier, max_stake, race_date')
    .eq('event_id', eventId)
    .maybeSingle();
  if (!data) return null;
  return {
    multiplier: Number(data.multiplier),
    maxStake: Number(data.max_stake),
    raceDate: data.race_date as string,
  };
}

// =====================================================================
// 称号
// =====================================================================

export interface BadgeRow {
  code: string;
  name: string;
  description: string;
  category: string;
  rarity: 'bronze' | 'silver' | 'gold' | 'crown';
  sort_order: number;
  season_code: string | null;
  /** 取得日時。未取得なら null */
  earned_at: string | null;
}

/** その人の称号を、未取得も含めて全部返す */
export async function getBadges(userId: string): Promise<BadgeRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('user_badge_list', { p_user_id: userId });
  if (error) return [];
  return (data ?? []) as BadgeRow[];
}
