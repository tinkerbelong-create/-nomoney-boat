-- =====================================================================
-- 的中率を「レース単位」にする + みんなの画面をレースごとにまとめる
--
-- これまでの的中率は「買った点数のうち当たった点数」だった。
-- 3連単を20点買って1点当たれば5%になってしまい、感覚と合わない。
-- 「投票したレースのうち、1点でも当たったレースの割合」に変える。
-- =====================================================================

-- ---------------------------------------------------------------------
-- レース単位の集計
-- ---------------------------------------------------------------------

drop materialized view if exists user_season_races;

create materialized view user_season_races as
select
  b.user_id,
  b.season_code,
  e.sport_code,
  count(distinct m.event_id)::int as race_count,
  count(distinct m.event_id) filter (where b.status = 'won')::int as race_hit_count
from bets b
join markets m on m.id = b.market_id
join events  e on e.id = m.event_id
where b.status in ('won', 'lost')
group by 1, 2, 3;

create unique index user_season_races_pk
  on user_season_races (user_id, season_code, sport_code);

-- 集計ビューは関数経由でしか読ませない（他人の成績を守るため）
revoke all on user_season_races from anon, authenticated;

-- 両方まとめて作り直す
create or replace function refresh_user_season_stats()
returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view user_season_stats;
  refresh materialized view user_season_races;
end;
$$;

revoke all on function refresh_user_season_stats() from public;
grant execute on function refresh_user_season_stats() to service_role;

-- ---------------------------------------------------------------------
-- 集計ビュー（的中率をレース単位に差し替え、レース数を末尾に追加）
-- ---------------------------------------------------------------------

create or replace view user_season_totals as
select
  s.user_id,
  s.season_code,
  s.bet_count,
  s.hit_count,
  s.total_stake,
  s.total_payout,
  s.profit,
  s.roi_pct,
  -- 的中率＝1点でも当たったレース ÷ 投票したレース
  case when coalesce(r.race_count, 0) > 0
       then round(r.race_hit_count::numeric / r.race_count * 100, 1)
       else null end as hit_pct,
  coalesce(r.race_count, 0)     as race_count,
  coalesce(r.race_hit_count, 0) as race_hit_count
from (
  select
    user_id,
    season_code,
    sum(bet_count)::int       as bet_count,
    sum(hit_count)::int       as hit_count,
    sum(total_stake)::bigint  as total_stake,
    sum(total_payout)::bigint as total_payout,
    sum(profit)::bigint       as profit,
    case when sum(total_stake) > 0
         then round(sum(total_payout)::numeric / sum(total_stake) * 100, 1)
         else null end as roi_pct
  from user_season_stats
  group by 1, 2
) s
left join (
  select user_id, season_code,
         sum(race_count)::int     as race_count,
         sum(race_hit_count)::int as race_hit_count
  from user_season_races
  group by 1, 2
) r on r.user_id = s.user_id and r.season_code = s.season_code;

create or replace view user_lifetime_totals as
select
  s.user_id,
  s.bet_count,
  s.hit_count,
  s.total_stake,
  s.total_payout,
  s.profit,
  s.roi_pct,
  case when coalesce(r.race_count, 0) > 0
       then round(r.race_hit_count::numeric / r.race_count * 100, 1)
       else null end as hit_pct,
  coalesce(r.race_count, 0)     as race_count,
  coalesce(r.race_hit_count, 0) as race_hit_count
from (
  select
    user_id,
    sum(bet_count)::int       as bet_count,
    sum(hit_count)::int       as hit_count,
    sum(total_stake)::bigint  as total_stake,
    sum(total_payout)::bigint as total_payout,
    sum(profit)::bigint       as profit,
    case when sum(total_stake) > 0
         then round(sum(total_payout)::numeric / sum(total_stake) * 100, 1)
         else null end as roi_pct
  from user_season_stats
  group by 1
) s
left join (
  select user_id,
         sum(race_count)::int     as race_count,
         sum(race_hit_count)::int as race_hit_count
  from user_season_races
  group by 1
) r on r.user_id = s.user_id;

-- ---------------------------------------------------------------------
-- ランキング（レース数を追加するので作り直し）
-- ---------------------------------------------------------------------

drop function if exists friend_ranking(text, text);

create function friend_ranking(
  p_season_code text,      -- null なら通算
  p_metric      text       -- 'profit' | 'roi' | 'hit'
)
returns table (
  user_id        uuid,
  handle         text,
  display_name   text,
  avatar_url     text,
  bet_count      int,
  hit_count      int,
  total_stake    bigint,
  total_payout   bigint,
  profit         bigint,
  roi_pct        numeric,
  hit_pct        numeric,
  is_me          boolean,
  race_count     int,
  race_hit_count int
)
language sql stable security definer set search_path = public as $$
  with circle as (
    select auth.uid() as uid
    union
    select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
    from friendships f
    where f.status = 'accepted'
      and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
  ),
  stats as (
    select t.user_id, t.bet_count, t.hit_count, t.total_stake,
           t.total_payout, t.profit, t.roi_pct, t.hit_pct,
           t.race_count, t.race_hit_count
    from user_season_totals t
    where p_season_code is not null and t.season_code = p_season_code
    union all
    select l.user_id, l.bet_count, l.hit_count, l.total_stake,
           l.total_payout, l.profit, l.roi_pct, l.hit_pct,
           l.race_count, l.race_hit_count
    from user_lifetime_totals l
    where p_season_code is null
  )
  select
    c.uid,
    p.handle,
    p.display_name,
    p.avatar_url,
    coalesce(s.bet_count, 0),
    coalesce(s.hit_count, 0),
    coalesce(s.total_stake, 0::bigint),
    coalesce(s.total_payout, 0::bigint),
    coalesce(s.profit, 0::bigint),
    s.roi_pct,
    s.hit_pct,
    c.uid = auth.uid(),
    coalesce(s.race_count, 0),
    coalesce(s.race_hit_count, 0)
  from circle c
  join profiles p on p.id = c.uid
  left join stats s on s.user_id = c.uid
  order by
    case when p_metric = 'roi'  then s.roi_pct end desc nulls last,
    case when p_metric = 'hit'  then s.hit_pct end desc nulls last,
    case when p_metric = 'profit' then coalesce(s.profit, 0::bigint) end desc nulls last;
$$;

grant execute on function friend_ranking(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 個人のレース単位の成績（自分 or 承認済みフレンドのみ）
-- ---------------------------------------------------------------------

create or replace function user_race_summary(
  p_user_id     uuid,
  p_season_code text default null
)
returns table (race_count int, race_hit_count int)
language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(r.race_count), 0)::int,
    coalesce(sum(r.race_hit_count), 0)::int
  from user_season_races r
  where r.user_id = p_user_id
    and (p_season_code is null or r.season_code = p_season_code)
    and (
      p_user_id = auth.uid()
      or exists (
        select 1 from friendships f
        where f.status = 'accepted'
          and ((f.requester_id = auth.uid() and f.addressee_id = p_user_id)
            or (f.addressee_id = auth.uid() and f.requester_id = p_user_id))
      )
    );
$$;

grant execute on function user_race_summary(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- みんなの画面。レースごとにまとめられるよう、レースの情報を足す。
-- ---------------------------------------------------------------------

drop function if exists friend_timeline(int);

create function friend_timeline(p_limit int default 200)
returns table (
  bet_id        uuid,
  user_id       uuid,
  handle        text,
  display_name  text,
  event_id      uuid,
  event_title   text,
  venue_name    text,
  venue_code    text,
  race_number   int,
  deadline_at   timestamptz,
  event_status  text,
  bet_type_code text,
  selection     text,
  stake         int,
  status        text,
  payout        bigint,
  occurred_at   timestamptz
)
language sql stable security invoker set search_path = public as $$
  select
    b.id, b.user_id, p.handle, p.display_name,
    e.id, e.title, e.venue_name, e.venue_code, e.race_number,
    e.deadline_at, e.status,
    m.bet_type_code, b.selection, b.stake, b.status, b.payout,
    coalesce(b.settled_at, m.closes_at)
  from bets b
  join markets  m on m.id = b.market_id
  join events   e on e.id = m.event_id
  join profiles p on p.id = b.user_id
  where m.closes_at <= now()
  order by coalesce(b.settled_at, m.closes_at) desc
  limit p_limit;
$$;

grant execute on function friend_timeline(int) to authenticated;

-- 作り直したので、いったん集計を作っておく
select refresh_user_season_stats();
