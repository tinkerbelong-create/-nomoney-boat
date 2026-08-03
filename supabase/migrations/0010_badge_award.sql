-- =====================================================================
-- 称号の判定
--
-- award_badges(user_id) を呼ぶと、その人が新しく取れる称号を全部入れる。
-- 精算のたびに1回呼ぶ。何度呼んでも結果は変わらない。
--
-- 連続◯◯（連勝・連敗・皆勤）は、レースを時系列に並べて
-- 「同じ結果が続いた塊の長さ」を数える定番のやり方で出している。
-- =====================================================================

create or replace function award_badges(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added int;
begin
  -- ------------------------------------------------------------------
  -- 下ごしらえ：レース単位の成績を一時表にまとめる
  -- ------------------------------------------------------------------
  create temp table if not exists _races (
    event_id    uuid,
    deadline_at timestamptz,
    venue_code  text,
    race_number int,
    day         date,
    hit         boolean,
    stake       bigint,
    payout      bigint,
    is_feature  boolean
  ) on commit drop;
  delete from _races;

  insert into _races
  select
    m.event_id,
    max(e.deadline_at),
    max(e.venue_code),
    max(e.race_number),
    max((e.deadline_at at time zone 'Asia/Tokyo')::date),
    bool_or(b.status = 'won'),
    sum(b.stake),
    sum(b.payout),
    bool_or(f.event_id is not null)
  from bets b
  join markets m on m.id = b.market_id
  join events  e on e.id = m.event_id
  left join daily_features f on f.event_id = m.event_id
  where b.user_id = p_user_id
    and b.status in ('won', 'lost')
  group by m.event_id;

  -- ------------------------------------------------------------------
  -- 判定して入れる
  -- ------------------------------------------------------------------
  with
  -- 1点ごとの記録
  bet_rows as (
    select b.*, m.bet_type_code, m.event_id,
           e.venue_code, e.race_number, e.deadline_at,
           substring(b.selection from 1 for 1) as head_lane,
           case when b.stake > 0 then b.payout::numeric / b.stake else 0 end as ratio
    from bets b
    join markets m on m.id = b.market_id
    join events  e on e.id = m.event_id
    where b.user_id = p_user_id
  ),
  totals as (
    select
      (select count(*) from _races)                          as races,
      (select count(*) from _races where hit)                as hits,
      (select coalesce(sum(payout), 0) from _races)          as total_payout,
      (select count(*) from bet_rows where status <> 'refunded') as tickets
  ),
  -- 連続の塊
  seq as (
    select hit, deadline_at,
           row_number() over (order by deadline_at)
             - row_number() over (partition by hit order by deadline_at) as grp
    from _races
  ),
  streaks as (
    select hit, count(*) as len from seq group by hit, grp
  ),
  max_streak as (
    select
      coalesce(max(len) filter (where hit), 0)     as win_streak,
      coalesce(max(len) filter (where not hit), 0) as lose_streak
    from streaks
  ),
  -- 投票した日の連続
  day_seq as (
    select day,
           day - (row_number() over (order by day))::int as grp
    from (select distinct day from _races) d
  ),
  day_streak as (
    select coalesce(max(cnt), 0) as days from (
      select count(*) as cnt from day_seq group by grp
    ) x
  ),
  -- お題レースに参加した日の連続
  feat_day_seq as (
    select day, day - (row_number() over (order by day))::int as grp
    from (select distinct day from _races where is_feature) d
  ),
  feat_day_streak as (
    select coalesce(max(cnt), 0) as days from (
      select count(*) as cnt from feat_day_seq group by grp
    ) x
  ),
  candidates as (
    -- はじめの一歩
    select 'first_bet'::text as code where exists (select 1 from bet_rows)
    union all select 'first_hit'  where exists (select 1 from _races where hit)
    union all select 'first_man'  where exists (select 1 from bet_rows where status='won' and ratio >= 100)
    union all select 'first_tri'  where exists (select 1 from bet_rows where status='won' and bet_type_code='trifecta')
    union all select 'first_trio' where exists (select 1 from bet_rows where status='won' and bet_type_code='trio')
    union all select 'first_friend' where exists (
      select 1 from friendships f where f.status='accepted'
        and (f.requester_id = p_user_id or f.addressee_id = p_user_id))
    union all select 'first_fav' where exists (select 1 from favorite_racers where user_id = p_user_id)

    -- 的中の数・参加数
    union all select 'hit_5'   from totals where hits >= 5
    union all select 'hit_10'  from totals where hits >= 10
    union all select 'hit_25'  from totals where hits >= 25
    union all select 'hit_50'  from totals where hits >= 50
    union all select 'hit_100' from totals where hits >= 100
    union all select 'hit_200' from totals where hits >= 200
    union all select 'hit_500' from totals where hits >= 500
    union all select 'play_10'   from totals where races >= 10
    union all select 'play_50'   from totals where races >= 50
    union all select 'play_100'  from totals where races >= 100
    union all select 'play_500'  from totals where races >= 500
    union all select 'play_1000' from totals where races >= 1000

    -- 連続的中・連敗
    union all select 'streak_2'  from max_streak where win_streak >= 2
    union all select 'streak_3'  from max_streak where win_streak >= 3
    union all select 'streak_5'  from max_streak where win_streak >= 5
    union all select 'streak_7'  from max_streak where win_streak >= 7
    union all select 'streak_10' from max_streak where win_streak >= 10
    union all select 'lose_3'   from max_streak where lose_streak >= 3
    union all select 'lose_5'   from max_streak where lose_streak >= 5
    union all select 'lose_10'  from max_streak where lose_streak >= 10
    union all select 'lose_20'  from max_streak where lose_streak >= 20
    union all select 'lose_30'  from max_streak where lose_streak >= 30
    union all select 'lose_50'  from max_streak where lose_streak >= 50
    union all select 'lose_100' from max_streak where lose_streak >= 100

    -- 負け
    union all select 'big_loss'   where exists (select 1 from _races where not hit and stake >= 10000)
    union all select 'huge_loss'  where exists (select 1 from _races where not hit and stake >= 50000)
    union all select 'broke'      where exists (
      select 1 from current_balances c where c.user_id = p_user_id and c.balance < 5000)
    union all select 'very_broke' where exists (
      select 1 from current_balances c where c.user_id = p_user_id and c.balance < 1000)

    -- 高配当
    union all select 'odds_10'   where exists (select 1 from bet_rows where status='won' and ratio >= 10)
    union all select 'odds_100'  where exists (select 1 from bet_rows where status='won' and ratio >= 100)
    union all select 'odds_300'  where exists (select 1 from bet_rows where status='won' and ratio >= 300)
    union all select 'odds_500'  where exists (select 1 from bet_rows where status='won' and ratio >= 500)
    union all select 'odds_1000' where exists (select 1 from bet_rows where status='won' and ratio >= 1000)
    union all select 'pay_100k'  where exists (select 1 from _races where payout >= 100000)
    union all select 'pay_500k'  where exists (select 1 from _races where payout >= 500000)
    union all select 'pop_20'  where exists (
      select 1 from bet_rows b join market_results r
        on r.market_id = b.market_id and r.winning_selection = b.selection
      where b.status='won' and r.popularity >= 20)
    union all select 'pop_50'  where exists (
      select 1 from bet_rows b join market_results r
        on r.market_id = b.market_id and r.winning_selection = b.selection
      where b.status='won' and r.popularity >= 50)
    union all select 'pop_120' where exists (
      select 1 from bet_rows b join market_results r
        on r.market_id = b.market_id and r.winning_selection = b.selection
      where b.status='won' and r.popularity >= 120)

    -- 賭け式
    union all select 'bt_' || bt || '_' || n from (
      select bt, n from (
        select bet_type_code as bt, count(distinct event_id) as c
        from bet_rows where status='won' group by bet_type_code
      ) s, (values (10),(50),(100)) as t(n)
      where s.c >= t.n
        and (s.bt in ('trifecta','trio','exacta','quinella')
             or (s.bt in ('win','place') and t.n <= 50))
    ) x
    union all select 'bt_all' where (
      select count(distinct bet_type_code) from bet_rows where status='won') >= 6

    -- 買い方（1レース1点だけ買ったか）
    union all select 'single_hit' where exists (
      select 1 from (select event_id, count(*) c, bool_or(status='won') w
                     from bet_rows group by event_id) s where s.c = 1 and s.w)
    union all select 'single_10' where (
      select count(*) from (select event_id, count(*) c, bool_or(status='won') w
                            from bet_rows group by event_id) s
      where s.c = 1 and s.w) >= 10
    union all select 'single_man' where exists (
      select 1 from (select event_id, count(*) c, max(ratio) r
                     from bet_rows where status='won' group by event_id) s
      where s.c = 1 and s.r >= 100)
    union all select 'bulk_50'  where exists (
      select 1 from (select event_id, count(*) c from bet_rows group by event_id) s where s.c >= 50)
    union all select 'bulk_120' where exists (
      select 1 from (select event_id, count(*) c from bet_rows group by event_id) s where s.c >= 120)
    union all select 'tickets_1000' from totals where tickets >= 1000

    -- 艇番
    union all select 'lane1_30' where (
      select count(distinct event_id) from bet_rows where status='won' and head_lane='1') >= 30
    union all select 'lane2_20' where (
      select count(distinct event_id) from bet_rows where status='won' and head_lane='2') >= 20
    union all select 'lane3_20' where (
      select count(distinct event_id) from bet_rows where status='won' and head_lane='3') >= 20
    union all select 'lane4_20' where (
      select count(distinct event_id) from bet_rows where status='won' and head_lane='4') >= 20
    union all select 'lane5_15' where (
      select count(distinct event_id) from bet_rows where status='won' and head_lane='5') >= 15
    union all select 'lane6_10' where (
      select count(distinct event_id) from bet_rows where status='won' and head_lane='6') >= 10
    union all select 'lane_all' where (
      select count(distinct head_lane) from bet_rows where status='won') >= 6
    union all select 'combo_123' where exists (
      select 1 from bet_rows where status='won' and selection = '1-2-3')
    union all select 'combo_654' where exists (
      select 1 from bet_rows where status='won' and selection = '6-5-4')

    -- 場めぐり
    union all select 'venue_' || venue_code from _races
      where hit group by venue_code having count(*) >= 3
    union all select 'venue_all' where (
      select count(distinct venue_code) from _races where hit) >= 24

    -- 収支
    union all select 'profit_day' where exists (
      select 1 from _races group by day having sum(payout) > sum(stake))
    union all select 'profit_100k' where exists (
      select 1 from user_season_totals t where t.user_id = p_user_id and t.profit >= 100000)
    union all select 'profit_500k' where exists (
      select 1 from user_season_totals t where t.user_id = p_user_id and t.profit >= 500000)
    union all select 'bal_100k' where exists (
      select 1 from current_balances c where c.user_id = p_user_id and c.balance >= 100000)
    union all select 'bal_150k' where exists (
      select 1 from current_balances c where c.user_id = p_user_id and c.balance >= 150000)
    union all select 'total_1m'  from totals where total_payout >= 1000000
    union all select 'total_10m' from totals where total_payout >= 10000000

    -- 習慣
    union all select 'morning' where exists (
      select 1 from _races where hit
        and extract(hour from deadline_at at time zone 'Asia/Tokyo') = 10)
    union all select 'noon' where exists (
      select 1 from _races where hit
        and extract(hour from deadline_at at time zone 'Asia/Tokyo') = 12)
    union all select 'night' where exists (
      select 1 from _races where hit
        and extract(hour from deadline_at at time zone 'Asia/Tokyo') >= 20)
    union all select 'r1'  where (select count(*) from _races where hit and race_number = 1) >= 10
    union all select 'r12' where (select count(*) from _races where hit and race_number = 12) >= 10
    union all select 'days_3'   from day_streak where days >= 3
    union all select 'days_7'   from day_streak where days >= 7
    union all select 'days_30'  from day_streak where days >= 30
    union all select 'days_100' from day_streak where days >= 100
    union all select 'days_365' from day_streak where days >= 365

    -- お題レース
    union all select 'feat_first' where exists (select 1 from _races where is_feature)
    union all select 'feat_hit'   where exists (select 1 from _races where is_feature and hit)
    union all select 'feat_hit_20' where (
      select count(*) from _races where is_feature and hit) >= 20
    union all select 'feat_hit_50' where (
      select count(*) from _races where is_feature and hit) >= 50
    union all select 'feat_man' where exists (
      select 1 from bet_rows b join daily_features f on f.event_id = b.event_id
      where b.status='won' and b.ratio >= 100)
    union all select 'feat_days_7'   from feat_day_streak where days >= 7
    union all select 'feat_days_30'  from feat_day_streak where days >= 30
    union all select 'feat_days_100' from feat_day_streak where days >= 100

    -- 対戦
    union all select 'friends_3' where (
      select count(*) from friendships f where f.status='accepted'
        and (f.requester_id = p_user_id or f.addressee_id = p_user_id)) >= 3
    union all select 'friends_5' where (
      select count(*) from friendships f where f.status='accepted'
        and (f.requester_id = p_user_id or f.addressee_id = p_user_id)) >= 5
    union all select 'friends_10' where (
      select count(*) from friendships f where f.status='accepted'
        and (f.requester_id = p_user_id or f.addressee_id = p_user_id)) >= 10

    -- 選手（お気に入りの選手が「頭」に来た買い目で的中したか）
    union all select 'fav_10' where (
      select count(*) from favorite_racers where user_id = p_user_id) >= 10
    union all select 'fav_hit' where exists (
      select 1 from bet_rows b
      join event_entrants ee on ee.event_id = b.event_id and ee.slot_code = b.head_lane
      join favorite_racers fr on fr.user_id = p_user_id and fr.racer_id = ee.meta->>'racerId'
      where b.status = 'won')
    union all select 'fav_hit_10' where (
      select count(distinct b.event_id) from bet_rows b
      join event_entrants ee on ee.event_id = b.event_id and ee.slot_code = b.head_lane
      join favorite_racers fr on fr.user_id = p_user_id and fr.racer_id = ee.meta->>'racerId'
      where b.status = 'won') >= 10
    union all select 'fav_man' where exists (
      select 1 from bet_rows b
      join event_entrants ee on ee.event_id = b.event_id and ee.slot_code = b.head_lane
      join favorite_racers fr on fr.user_id = p_user_id and fr.racer_id = ee.meta->>'racerId'
      where b.status = 'won' and b.ratio >= 100)
  )
  insert into user_badges (user_id, badge_code)
  select p_user_id, c.code
  from candidates c
  join badges bd on bd.code = c.code
  on conflict do nothing;

  get diagnostics v_added = row_count;

  -- コレクション系は最後に数える
  insert into user_badges (user_id, badge_code)
  select p_user_id, x.code
  from (values ('collect_10', 10), ('collect_50', 50), ('collect_100', 100)) as x(code, n)
  where (select count(*) from user_badges ub where ub.user_id = p_user_id) >= x.n
  on conflict do nothing;

  return v_added;
end;
$$;

revoke all on function award_badges(uuid) from public;
grant execute on function award_badges(uuid) to service_role;

-- =====================================================================
-- 月間タイトル（◯年◯月の王者 など）
-- =====================================================================

create or replace function award_monthly_titles(p_season_code text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
  v_count int := 0;
begin
  -- '2026-08' → '2026年8月'
  v_label := split_part(p_season_code, '-', 1) || '年'
           || ltrim(split_part(p_season_code, '-', 2), '0') || '月';

  -- 称号そのものを作る（その月のぶん）
  insert into badges (code, name, description, category, rarity, sort_order, season_code) values
    ('title_' || p_season_code || '_champion',
      v_label || 'の王者', v_label || 'の収支1位', 'title', 'crown', 300, p_season_code),
    ('title_' || p_season_code || '_hit',
      v_label || 'の的中王', v_label || 'の的中率1位', 'title', 'gold', 301, p_season_code),
    ('title_' || p_season_code || '_roi',
      v_label || 'の回収王', v_label || 'の回収率1位', 'title', 'gold', 302, p_season_code),
    ('title_' || p_season_code || '_full',
      v_label || 'の皆勤賞', v_label || 'に20日以上投票', 'title', 'silver', 303, p_season_code),
    ('title_' || p_season_code || '_loser',
      v_label || 'の大敗王', v_label || 'の収支最下位', 'title', 'bronze', 304, p_season_code)
  on conflict (code) do nothing;

  -- 収支1位
  insert into user_badges (user_id, badge_code)
  select t.user_id, 'title_' || p_season_code || '_champion'
  from user_season_totals t
  where t.season_code = p_season_code and t.race_count > 0
  order by t.profit desc limit 1
  on conflict do nothing;

  -- 的中率1位（20レース以上）
  insert into user_badges (user_id, badge_code)
  select t.user_id, 'title_' || p_season_code || '_hit'
  from user_season_totals t
  where t.season_code = p_season_code and t.race_count >= 20 and t.hit_pct is not null
  order by t.hit_pct desc limit 1
  on conflict do nothing;

  -- 回収率1位（20レース以上）
  insert into user_badges (user_id, badge_code)
  select t.user_id, 'title_' || p_season_code || '_roi'
  from user_season_totals t
  where t.season_code = p_season_code and t.race_count >= 20 and t.roi_pct is not null
  order by t.roi_pct desc limit 1
  on conflict do nothing;

  -- 皆勤賞（20日以上投票）
  insert into user_badges (user_id, badge_code)
  select b.user_id, 'title_' || p_season_code || '_full'
  from bets b
  join markets m on m.id = b.market_id
  join events  e on e.id = m.event_id
  where b.season_code = p_season_code
  group by b.user_id
  having count(distinct (e.deadline_at at time zone 'Asia/Tokyo')::date) >= 20
  on conflict do nothing;

  -- 大敗王（収支最下位。2人以上いるときだけ）
  insert into user_badges (user_id, badge_code)
  select t.user_id, 'title_' || p_season_code || '_loser'
  from user_season_totals t
  where t.season_code = p_season_code and t.race_count > 0
    and (select count(*) from user_season_totals x
         where x.season_code = p_season_code and x.race_count > 0) >= 2
  order by t.profit asc limit 1
  on conflict do nothing;

  select count(*) into v_count from user_badges
  where badge_code like 'title_' || p_season_code || '%';

  return v_count;
end;
$$;

revoke all on function award_monthly_titles(text) from public;
grant execute on function award_monthly_titles(text) to service_role;

-- =====================================================================
-- 画面用：自分（またはフレンド）の称号を、未取得も含めて全部返す
-- =====================================================================

create or replace function user_badge_list(p_user_id uuid)
returns table (
  code        text,
  name        text,
  description text,
  category    text,
  rarity      text,
  sort_order  int,
  season_code text,
  earned_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select b.code, b.name, b.description, b.category, b.rarity, b.sort_order,
         b.season_code, ub.earned_at
  from badges b
  left join user_badges ub on ub.badge_code = b.code and ub.user_id = p_user_id
  where p_user_id = auth.uid()
     or exists (
       select 1 from friendships f
       where f.status = 'accepted'
         and ((f.requester_id = auth.uid() and f.addressee_id = p_user_id)
           or (f.addressee_id = auth.uid() and f.requester_id = p_user_id))
     )
  order by (ub.earned_at is null), b.sort_order, b.code;
$$;

grant execute on function user_badge_list(uuid) to authenticated;
