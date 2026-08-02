-- =====================================================================
-- ノーマネー予想対戦サイト / 初期スキーマ
-- 現金・暗号資産・換金可能な景品を扱う機能は一切含まない。
-- ポイントは全て point_ledger の積み上げで表現し、残高列は持たない。
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------
-- 1. プロフィールとフレンド
-- ---------------------------------------------------------------------

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  handle       text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 30),
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create index profiles_display_name_trgm on profiles using gin (display_name gin_trgm_ops);
create index profiles_handle_trgm       on profiles using gin (handle gin_trgm_ops);

create table friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

-- 向きを無視した重複申請の防止
create unique index friendships_pair_uniq on friendships (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
);
create index friendships_addressee_idx on friendships (addressee_id, status);

create or replace function are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and least(requester_id, addressee_id)    = least(a, b)
      and greatest(requester_id, addressee_id) = greatest(a, b)
  );
$$;

-- ---------------------------------------------------------------------
-- 2. シーズンとポイント台帳
-- ---------------------------------------------------------------------

create table seasons (
  code         text primary key,                    -- '2026-08'
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  grant_amount int not null default 50000,
  closed_at    timestamptz
);

create table point_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  season_code text not null references seasons(code),
  entry_type  text not null
                check (entry_type in ('grant', 'bet', 'payout', 'refund', 'adjust')),
  amount      bigint not null,                      -- 符号つき。bet は負
  ref_type    text,
  ref_id      uuid,
  memo        text,
  created_at  timestamptz not null default now()
);

create index point_ledger_user_season_idx on point_ledger (user_id, season_code);

-- 月初付与の二重実行を防ぐ
create unique index point_ledger_grant_uniq
  on point_ledger (user_id, season_code) where entry_type = 'grant';

-- 精算バッチの再実行で払戻が二重計上されるのを防ぐ
create unique index point_ledger_ref_uniq
  on point_ledger (ref_type, ref_id, entry_type) where ref_id is not null;

-- security_invoker を付けるのが重要。
-- これがないとビューは作成者（postgres）の権限で動き、point_ledger の RLS を
-- 素通りして「全員の残高」が誰にでも見えてしまう。
create view current_balances with (security_invoker = on) as
  select user_id, season_code, sum(amount)::bigint as balance
  from point_ledger group by 1, 2;

-- ---------------------------------------------------------------------
-- 3. 競技マスタ
--    今はボートレースのみ。将来の競技はここに行を足すだけで載る。
-- ---------------------------------------------------------------------

create table sports (
  code        text primary key,
  name        text not null,
  adapter_key text not null,
  sort_order  int not null default 0
);

create table bet_types (
  sport_code     text not null references sports(code) on delete cascade,
  code           text not null,
  name           text not null,
  short_name     text not null,
  selection_kind text not null
                   check (selection_kind in
                          ('single', 'combo_ordered', 'combo_unordered', 'enumerated')),
  pick_count     int not null default 1,
  sort_order     int not null default 0,
  primary key (sport_code, code)
);

-- ---------------------------------------------------------------------
-- 4. イベント・出走・マーケット
-- ---------------------------------------------------------------------

create table events (
  id           uuid primary key default gen_random_uuid(),
  sport_code   text not null references sports(code),
  external_key text not null,                        -- 'boatrace:20260801:11:12'
  title        text not null,
  venue_code   text,                                 -- '11'
  venue_name   text,                                 -- 'びわこ'
  race_number  int,
  grade        text,
  scheduled_at timestamptz not null,
  deadline_at  timestamptz not null,                 -- 締切。投票可否の唯一の基準
  status       text not null default 'scheduled'
                 check (status in ('scheduled', 'closed', 'resolved', 'cancelled')),
  meta         jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (sport_code, external_key)
);

create index events_sport_sched_idx on events (sport_code, scheduled_at);
create index events_status_idx      on events (status, deadline_at);

create table event_entrants (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  slot_code    text not null,                        -- '1'..'6'（艇番）
  number_label text not null,
  name         text not null,
  meta         jsonb not null default '{}',          -- 登録番号/級別/モーター2連率など
  sort_order   int not null default 0,
  unique (event_id, slot_code)
);

create table markets (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  sport_code      text not null,
  bet_type_code   text not null,
  settlement_mode text not null default 'official'
                    check (settlement_mode in ('official', 'parimutuel')),
  status          text not null default 'open'
                    check (status in ('open', 'closed', 'settled', 'void')),
  closes_at       timestamptz not null,
  min_stake       int not null default 100,
  stake_step      int not null default 100,
  pool_total      bigint not null default 0,
  foreign key (sport_code, bet_type_code)
    references bet_types (sport_code, code),
  unique (event_id, bet_type_code)
);

create index markets_event_idx  on markets (event_id);
create index markets_status_idx on markets (status, closes_at);

-- ---------------------------------------------------------------------
-- 5. 投票と結果
-- ---------------------------------------------------------------------

create table bets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  market_id   uuid not null references markets(id) on delete cascade,
  season_code text not null references seasons(code),
  selection   text not null,                         -- 正規化済み '1-2-5' / '1=2'
  stake       int not null check (stake > 0),
  status      text not null default 'placed'
                check (status in ('placed', 'won', 'lost', 'refunded')),
  payout      bigint not null default 0,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz
);

create index bets_market_status_idx on bets (market_id, status);
create index bets_user_created_idx  on bets (user_id, created_at desc);
create index bets_season_user_idx   on bets (season_code, user_id);

create table market_results (
  id                uuid primary key default gen_random_uuid(),
  market_id         uuid not null references markets(id) on delete cascade,
  winning_selection text not null,
  payout_per_100    int not null,                    -- 100pt賭けたときの払戻pt
  popularity        int,
  unique (market_id, winning_selection)
);

-- 着順・気象など、結果画面の表示用
create table event_results (
  event_id     uuid primary key references events(id) on delete cascade,
  placings     jsonb not null default '[]',          -- [{rank,slot,name,time}]
  refunded     text[] not null default '{}',         -- 返還艇番
  weather      jsonb not null default '{}',
  decided_by   text,                                 -- 決まり手
  resolved_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. 投票RPC
--    残高チェック・ポイント減算・投票作成を1トランザクションに閉じる。
-- ---------------------------------------------------------------------

create or replace function place_bet(
  p_market_id uuid,
  p_selection text,
  p_stake     int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_season  text;
  v_bet     uuid;
  v_balance bigint;
  v_market  markets%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_market from markets where id = p_market_id for update;
  if not found then
    raise exception 'market not found' using errcode = 'P0002';
  end if;

  if v_market.status <> 'open' or v_market.closes_at <= now() then
    raise exception '締切済みです' using errcode = 'P0001';
  end if;

  if p_stake < v_market.min_stake or (p_stake % v_market.stake_step) <> 0 then
    raise exception '賭け点数が不正です' using errcode = 'P0001';
  end if;

  select code into v_season from seasons
   where now() >= starts_at and now() < ends_at
   limit 1;
  if v_season is null then
    raise exception 'シーズンが開いていません' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_balance
    from point_ledger where user_id = v_user and season_code = v_season;

  if v_balance < p_stake then
    raise exception 'ポイントが足りません' using errcode = 'P0001';
  end if;

  insert into bets (user_id, market_id, season_code, selection, stake)
  values (v_user, p_market_id, v_season, p_selection, p_stake)
  returning id into v_bet;

  insert into point_ledger (user_id, season_code, entry_type, amount, ref_type, ref_id)
  values (v_user, v_season, 'bet', -p_stake, 'bet', v_bet);

  update markets set pool_total = pool_total + p_stake where id = p_market_id;

  return v_bet;
end $$;

revoke all on function place_bet(uuid, text, int) from public;
grant execute on function place_bet(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------
-- 7. 集計（ランキング・個人成績）
-- ---------------------------------------------------------------------

create materialized view user_season_stats as
select
  b.user_id,
  b.season_code,
  e.sport_code,
  m.bet_type_code,
  count(*)::int                                          as bet_count,
  count(*) filter (where b.status = 'won')::int          as hit_count,
  coalesce(sum(b.stake), 0)::bigint                      as total_stake,
  coalesce(sum(b.payout), 0)::bigint                     as total_payout,
  (coalesce(sum(b.payout), 0) - coalesce(sum(b.stake), 0))::bigint as profit
from bets b
join markets m on m.id = b.market_id
join events  e on e.id = m.event_id
where b.status in ('won', 'lost')
group by 1, 2, 3, 4;

create unique index user_season_stats_pk
  on user_season_stats (user_id, season_code, sport_code, bet_type_code);
create index user_season_stats_user_idx on user_season_stats (user_id);

-- マテリアライズドビューには RLS をかけられない。
-- 直接読めるままにすると、フレンドでない他人の成績まで見えてしまうため、
-- クライアントからのアクセスを遮断し、後述の関数経由でのみ読ませる。
revoke all on user_season_stats from anon, authenticated;

-- ランキング用にシーズン単位へ畳んだビュー
create view user_season_totals as
select
  user_id,
  season_code,
  sum(bet_count)::int    as bet_count,
  sum(hit_count)::int    as hit_count,
  sum(total_stake)::bigint  as total_stake,
  sum(total_payout)::bigint as total_payout,
  sum(profit)::bigint       as profit,
  case when sum(total_stake) > 0
       then round(sum(total_payout)::numeric / sum(total_stake) * 100, 1)
       else null end as roi_pct,
  case when sum(bet_count) > 0
       then round(sum(hit_count)::numeric / sum(bet_count) * 100, 1)
       else null end as hit_pct
from user_season_stats
group by 1, 2;

-- 通算（全シーズン合計）
create view user_lifetime_totals as
select
  user_id,
  sum(bet_count)::int    as bet_count,
  sum(hit_count)::int    as hit_count,
  sum(total_stake)::bigint  as total_stake,
  sum(total_payout)::bigint as total_payout,
  sum(profit)::bigint       as profit,
  case when sum(total_stake) > 0
       then round(sum(total_payout)::numeric / sum(total_stake) * 100, 1)
       else null end as roi_pct,
  case when sum(bet_count) > 0
       then round(sum(hit_count)::numeric / sum(bet_count) * 100, 1)
       else null end as hit_pct
from user_season_stats
group by 1;

-- 集計ビューも同じ理由でクライアントから直接は読ませない。
revoke all on user_season_totals   from anon, authenticated;
revoke all on user_lifetime_totals from anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Row Level Security
-- ---------------------------------------------------------------------

alter table profiles       enable row level security;
alter table friendships    enable row level security;
alter table point_ledger   enable row level security;
alter table bets           enable row level security;
alter table events         enable row level security;
alter table event_entrants enable row level security;
alter table markets        enable row level security;
alter table market_results enable row level security;
alter table event_results  enable row level security;
alter table sports         enable row level security;
alter table bet_types      enable row level security;
alter table seasons        enable row level security;

-- プロフィール: 検索のため全認証ユーザーが読める。書けるのは本人だけ。
create policy profiles_select on profiles for select to authenticated using (true);
create policy profiles_insert on profiles for insert to authenticated
  with check (id = auth.uid());
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- フレンド: 当事者のみ
create policy friendships_select on friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy friendships_insert on friendships for insert to authenticated
  with check (requester_id = auth.uid());
create policy friendships_update on friendships for update to authenticated
  using (addressee_id = auth.uid() or requester_id = auth.uid());
create policy friendships_delete on friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- ポイント台帳: 本人のみ閲覧。書き込みは service role だけ（ポリシーを作らない）。
create policy point_ledger_select on point_ledger for select to authenticated
  using (user_id = auth.uid());

-- 投票: 本人は常に見える。フレンドの投票は「締切後」だけ見える。
create policy bets_select_own on bets for select to authenticated
  using (user_id = auth.uid());

create policy bets_select_friends on bets for select to authenticated
  using (
    are_friends(auth.uid(), user_id)
    and exists (
      select 1 from markets m
      where m.id = bets.market_id and m.closes_at <= now()
    )
  );

-- マスタ系は誰でも読める。書き込みは service role のみ。
create policy sports_select         on sports         for select to authenticated using (true);
create policy bet_types_select      on bet_types      for select to authenticated using (true);
create policy seasons_select        on seasons        for select to authenticated using (true);
create policy events_select         on events         for select to authenticated using (true);
create policy entrants_select       on event_entrants for select to authenticated using (true);
create policy markets_select        on markets        for select to authenticated using (true);
create policy market_results_select on market_results for select to authenticated using (true);
create policy event_results_select  on event_results  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 9. 新規ユーザーへの当月ポイント自動付与
-- ---------------------------------------------------------------------

create or replace function grant_current_season_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_season seasons%rowtype;
begin
  select * into v_season from seasons
   where now() >= starts_at and now() < ends_at limit 1;

  if found then
    insert into point_ledger (user_id, season_code, entry_type, amount, memo)
    values (new.id, v_season.code, 'grant', v_season.grant_amount, '登録時付与')
    on conflict do nothing;
  end if;

  return new;
end $$;

create trigger profiles_grant_points
  after insert on profiles
  for each row execute function grant_current_season_points();
