-- =====================================================================
-- 今日のお題レース
--
--   ・毎日1レースだけ、みんなが同じレースを予想する
--   ・払戻は2倍
--   ・使えるのは1人5,000ptまで（全財産を突っ込むだけのゲームにしない）
--
-- 上限はアプリ側だけで数えると、同時に2回押されたときに抜ける。
-- データベース側でも必ず止める。
-- =====================================================================

create table if not exists daily_features (
  race_date   date        primary key,           -- JSTの日付
  event_id    uuid        not null references events(id) on delete cascade,
  multiplier  numeric     not null default 2.0,
  max_stake   int         not null default 5000,
  created_at  timestamptz not null default now()
);

create index if not exists daily_features_event_idx on daily_features (event_id);

alter table daily_features enable row level security;

drop policy if exists daily_features_read on daily_features;
create policy daily_features_read on daily_features
  for select using (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- 上限のチェック
-- ---------------------------------------------------------------------

create or replace function enforce_daily_feature_cap()
returns trigger
language plpgsql
as $$
declare
  v_event uuid;
  v_max   int;
  v_used  bigint;
begin
  select m.event_id into v_event from markets m where m.id = new.market_id;
  if v_event is null then return new; end if;

  select f.max_stake into v_max from daily_features f where f.event_id = v_event;
  if v_max is null then return new; end if;   -- お題レースではない

  select coalesce(sum(b.stake), 0) into v_used
  from bets b
  join markets m on m.id = b.market_id
  where m.event_id = v_event
    and b.user_id = new.user_id
    and b.status <> 'refunded';

  if v_used + new.stake > v_max then
    raise exception 'お題レースは1人%ptまでです（すでに%pt使っています）', v_max, v_used
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists bets_daily_feature_cap on bets;
create trigger bets_daily_feature_cap
  before insert on bets
  for each row execute function enforce_daily_feature_cap();

-- ---------------------------------------------------------------------
-- 今日のお題を1件返す
-- ---------------------------------------------------------------------

create or replace function today_feature()
returns table (
  event_id    uuid,
  race_date   date,
  multiplier  numeric,
  max_stake   int,
  title       text,
  venue_name  text,
  venue_code  text,
  race_number int,
  deadline_at timestamptz,
  status      text,
  my_stake    int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.event_id,
    f.race_date,
    f.multiplier,
    f.max_stake,
    e.title,
    e.venue_name,
    e.venue_code,
    e.race_number,
    e.deadline_at,
    e.status,
    coalesce((
      select sum(b.stake)::int
      from bets b
      join markets m on m.id = b.market_id
      where m.event_id = f.event_id and b.user_id = auth.uid()
    ), 0)
  from daily_features f
  join events e on e.id = f.event_id
  where f.race_date = (now() at time zone 'Asia/Tokyo')::date
  limit 1;
$$;

grant execute on function today_feature() to authenticated;
