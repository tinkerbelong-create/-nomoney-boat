-- =====================================================================
-- 生き物の抽選と付与
--
-- 精算のたびに award_creature(user_id, event_id) を1回呼ぶ。
-- 称号（award_badges）を呼んでいるすぐ横で呼ぶ。
--
-- 【流れ】
--   ① そのレースで的中しているか。していなければ何もしない
--   ② 一番よかった的中（払戻倍率が最大のもの）を1つ取る
--   ③ 倍率帯 × 掛け金帯 → グレード。等級ボーナスを足して天井で止める
--   ④ グレードの重みに従って★を1つ引く
--   ⑤ その★の中から、このレースで出る条件を満たすものだけに絞る
--   ⑥ 候補から等確率で1体。重複は気にしない
--   ⑦ 台帳に積み、水槽に空きがあれば入れる
--
-- 1レース1回きり。creature_draws の主キーで担保する。
-- =====================================================================

/** 払戻倍率 → 倍率帯 1..7 */
create or replace function creature_odds_rank(p_ratio numeric)
returns int language sql immutable as $$
  select case
    when p_ratio >= 1000 then 7
    when p_ratio >=  500 then 6
    when p_ratio >=  300 then 5
    when p_ratio >=  100 then 4
    when p_ratio >=   30 then 3
    when p_ratio >=   10 then 2
    else 1 end
$$;

/**
 * 掛け金 → 掛け金帯 1..5
 * このアプリは100pt刻みでしか賭けられない。1000ptで頭打ち。
 * それ以上いくら積んでも変わらないので、無茶なベットを誘わない。
 */
create or replace function creature_stake_rank(p_stake int)
returns int language sql immutable as $$
  select case
    when p_stake >= 1000 then 5
    when p_stake >=  800 then 4
    when p_stake >=  500 then 3
    when p_stake >=  200 then 2
    else 1 end
$$;

/** 重み配列から1つ引く。1〜10 を返す */
create or replace function creature_pick_star(p_weights int[])
returns int language plpgsql as $$
declare
  v_total int := 0;
  v_roll  int;
  v_acc   int := 0;
  i       int;
begin
  for i in 1..10 loop v_total := v_total + p_weights[i]; end loop;
  if v_total <= 0 then return 1; end if;
  v_roll := floor(random() * v_total)::int;   -- 0 .. total-1
  for i in 1..10 loop
    v_acc := v_acc + p_weights[i];
    if v_roll < v_acc then return i; end if;
  end loop;
  return 10;
end;
$$;

-- ---------------------------------------------------------------------
-- 本体
-- ---------------------------------------------------------------------

create or replace function award_creature(p_user_id uuid, p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev      events%rowtype;
  v_bet     record;
  v_ratio   numeric;
  v_orank   int;
  v_srank   int;
  v_grade   int;
  v_cap     int;
  v_bonus   int;
  v_star    int;
  v_code    text;
  v_water   text;
  v_area    text;
  v_night   boolean;
  v_tank    uuid;
  v_meta    jsonb;
begin
  -- ① もう引いている？
  if exists (select 1 from creature_draws d
             where d.user_id = p_user_id and d.event_id = p_event_id) then
    return null;
  end if;

  select * into v_ev from events where id = p_event_id;
  if not found then return null; end if;

  -- ② いちばん良かった的中を1つ。1レースで複数当たっても生き物は1体
  select b.stake, b.payout, m.bet_type_code, b.selection,
         (b.payout::numeric / nullif(b.stake, 0)) as ratio
    into v_bet
  from bets b
  join markets m on m.id = b.market_id
  where b.user_id = p_user_id
    and m.event_id = p_event_id
    and b.status = 'won'
    and b.stake > 0
  order by (b.payout::numeric / nullif(b.stake, 0)) desc
  limit 1;

  -- 外れたレースでは何ももらえない。引いた記録も残さない
  -- （あとで結果が訂正されて的中になる可能性を残すため）
  if not found then return null; end if;

  v_ratio := coalesce(v_bet.ratio, 0);
  v_orank := creature_odds_rank(v_ratio);
  v_srank := creature_stake_rank(v_bet.stake);

  -- ③ グレード
  select g.grade into v_grade from creature_grade_grid g
   where g.odds_rank = v_orank and g.stake_rank = v_srank;
  if v_grade is null then v_grade := 1; end if;

  select coalesce(b.bonus, 0) into v_bonus from creature_grade_bonus b
   where b.grade_code = coalesce(v_ev.grade, '一般');
  v_bonus := coalesce(v_bonus, 0);

  -- 天井。1000倍×1000pt のマスだけ G10 に届く
  if v_orank = 7 and v_srank = 5 then
    v_cap := 10;
  else
    select c.cap into v_cap from creature_grade_cap c where c.odds_rank = v_orank;
    v_cap := coalesce(v_cap, 9);
  end if;

  v_grade := least(v_grade + v_bonus, v_cap);

  -- ④ ★を引く
  select creature_pick_star(r.weights) into v_star from creature_rates r where r.grade = v_grade;
  if v_star is null then v_star := 1; end if;

  -- ⑤ このレースで出る条件
  select t.water, t.area into v_water, v_area
    from venue_traits t where t.venue_code = v_ev.venue_code;
  v_night := is_night_race(v_ev.deadline_at);

  -- ⑥ 候補から等確率で1体
  select c.code into v_code
  from creatures c
  where c.star = v_star
    and (
      -- ベース。条件なしはどこでも出る
      (c.water is null and c.area is null and c.night = false and c.venue_code is null)
      or c.water = v_water
      or c.area  = v_area
      or (c.night and v_night)
      or c.venue_code = v_ev.venue_code
    )
  order by random()
  limit 1;

  -- 候補が無いのは設計の破綻。黙って諦めずに記録を残す
  if v_code is null then
    raise warning '[creature] ★% の候補がありません（event=% venue=%）', v_star, p_event_id, v_ev.venue_code;
    return null;
  end if;

  -- ⑦ 記録して積む
  v_meta := jsonb_build_object(
    'eventId',   p_event_id,
    'venue',     v_ev.venue_name,
    'raceNo',    v_ev.race_number,
    'deadline',  v_ev.deadline_at,
    'raceGrade', v_ev.grade,
    'betType',   v_bet.bet_type_code,
    'selection', v_bet.selection,
    'stake',     v_bet.stake,
    'payout',    v_bet.payout,
    'ratio',     round(v_ratio, 1)
  );

  insert into creature_draws (user_id, event_id, creature_code, star)
  values (p_user_id, p_event_id, v_code, v_star);

  insert into user_creatures (user_id, creature_code, count, meta)
  values (p_user_id, v_code, 1, v_meta)
  on conflict (user_id, creature_code) do update
    set count = user_creatures.count + 1, last_at = now();

  -- 水槽に空きがあれば入れる。満杯なら図鑑には載るが水槽には出ない
  select t.id into v_tank from tanks t where t.user_id = p_user_id order by t.idx limit 1;
  if v_tank is null then
    insert into tanks (user_id, idx, name) values (p_user_id, 1, 'すいそう')
    returning id into v_tank;
  end if;

  if (select count(*) from tank_creatures tc where tc.tank_id = v_tank) < tank_capacity() then
    insert into tank_creatures (tank_id, creature_code)
    values (v_tank, v_code) on conflict do nothing;
  end if;

  return v_code;
end;
$$;

revoke all on function award_creature(uuid, uuid) from public;
grant execute on function award_creature(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 過去の的中をさかのぼって付与する
--
-- 水槽を入れた時点で、それまでの的中はすべて記録済みなのに何ももらえない。
-- それだと「開いたら空っぽ」になってしまうので、一度だけ遡って配る。
--
-- 何度実行しても安全（creature_draws があるレースは飛ばす）。
-- ---------------------------------------------------------------------

create or replace function backfill_creatures(p_user_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  v_n   int := 0;
begin
  for r in
    select distinct b.user_id, m.event_id
    from bets b
    join markets m on m.id = b.market_id
    join events  e on e.id = m.event_id
    where b.status = 'won'
      and (p_user_id is null or b.user_id = p_user_id)
      and not exists (
        select 1 from creature_draws d
        where d.user_id = b.user_id and d.event_id = m.event_id
      )
    order by m.event_id
  loop
    if award_creature(r.user_id, r.event_id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function backfill_creatures(uuid) from public;
grant execute on function backfill_creatures(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 画面用の読み取り
-- ---------------------------------------------------------------------

/** 図鑑。未取得も含めて全部返す。user_badge_list と同じ形 */
create or replace function creature_book(p_user_id uuid)
returns table (
  code text, name text, star int, category text, family text,
  color_a text, color_b text, move text,
  water text, area text, night boolean, venue_code text, description text,
  count int, first_at timestamptz, meta jsonb
)
language sql stable security definer set search_path = public as $$
  select c.code, c.name, c.star, c.category, c.family,
         c.color_a, c.color_b, c.move,
         c.water, c.area, c.night, c.venue_code, c.description,
         coalesce(uc.count, 0), uc.first_at, coalesce(uc.meta, '{}'::jsonb)
  from creatures c
  left join user_creatures uc on uc.creature_code = c.code and uc.user_id = p_user_id
  where p_user_id = auth.uid()
     or exists (
       select 1 from friendships f
       where f.status = 'accepted'
         and ((f.requester_id = auth.uid() and f.addressee_id = p_user_id)
           or (f.addressee_id = auth.uid() and f.requester_id = p_user_id))
     )
  order by c.star, c.sort_order, c.code;
$$;

grant execute on function creature_book(uuid) to authenticated;

/** いま水槽に入っているものだけ */
create or replace function tank_view(p_user_id uuid)
returns table (
  code text, name text, star int, category text, family text,
  color_a text, color_b text, move text, count int, meta jsonb
)
language sql stable security definer set search_path = public as $$
  select c.code, c.name, c.star, c.category, c.family,
         c.color_a, c.color_b, c.move,
         coalesce(uc.count, 1), coalesce(uc.meta, '{}'::jsonb)
  from tanks t
  join tank_creatures tc on tc.tank_id = t.id
  join creatures c on c.code = tc.creature_code
  left join user_creatures uc on uc.creature_code = c.code and uc.user_id = t.user_id
  where t.user_id = p_user_id
    and (p_user_id = auth.uid()
         or exists (
           select 1 from friendships f
           where f.status = 'accepted'
             and ((f.requester_id = auth.uid() and f.addressee_id = p_user_id)
               or (f.addressee_id = auth.uid() and f.requester_id = p_user_id))
         ))
  order by tc.added_at;
$$;

grant execute on function tank_view(uuid) to authenticated;
