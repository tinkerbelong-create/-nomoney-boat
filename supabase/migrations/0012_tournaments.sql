-- =====================================================================
-- 大会
--
-- 部屋（rooms）はやめて、大会に置き換える。
--
-- 【ルール】
--   ・招待コードで入る。作成者がアナウンスを書ける
--   ・期間は 1日 / 1週間 / 2週間
--   ・対象レースは「指定したレースだけ」か「期間中の全レース」
--   ・参加費（＝開始ポイント）を作成者が決める。全員が同じ額から始まる
--   ・入るとき所持ポイントから参加費が引かれ、同額が大会ポイントになる
--   ・大会ポイントが0になったらそこで終了。追加はできない
--   ・始まったら新規参加はできない
--   ・終わると、大会ポイントの残りがそのまま所持ポイントに戻る
--
-- 大会ポイントは所持ポイントとは別の財布（tournament_ledger）で持つ。
-- こうしておくと、普段のランキングに大会の成績が混ざらない。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 部屋を撤去
--
-- 先にテーブルを消すこと。ポリシーが is_room_member() を使っているので、
-- 関数を先に消そうとすると「他のものが依存している」と怒られる。
-- テーブルを消せばポリシーも一緒に消える。
-- ---------------------------------------------------------------------
drop table if exists room_titles   cascade;
drop table if exists room_messages cascade;
drop table if exists room_members  cascade;
drop table if exists rooms         cascade;

drop function if exists room_ranking(uuid, text, text);
drop function if exists room_timeline(uuid, int);
drop function if exists award_room_titles(text);
drop function if exists create_room(text);
drop function if exists join_room(text);
drop function if exists leave_room(uuid);
drop function if exists my_rooms();
drop function if exists is_room_member(uuid) cascade;

-- ---------------------------------------------------------------------
-- 大会
-- ---------------------------------------------------------------------

create table if not exists tournaments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 40),
  invite_code  text not null unique,
  owner_id     uuid not null references profiles(id) on delete cascade,
  announcement text not null default '',
  entry_fee    int  not null check (entry_fee between 100 and 100000),
  /** 'selected' = 指定レースだけ / 'all' = 期間中の全レース */
  scope        text not null default 'selected' check (scope in ('selected', 'all')),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  /** 'open' 募集中 / 'running' 開催中 / 'finished' 終了 / 'cancelled' 中止 */
  status       text not null default 'open'
                 check (status in ('open', 'running', 'finished', 'cancelled')),
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists tournament_races (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  event_id      uuid not null references events(id) on delete cascade,
  primary key (tournament_id, event_id)
);

create table if not exists tournament_entries (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  entry_fee     int  not null,
  joined_at     timestamptz not null default now(),
  /** 終了時に確定した大会ポイント */
  final_points  bigint,
  settled_at    timestamptz,
  primary key (tournament_id, user_id)
);

create index if not exists tournament_entries_user_idx on tournament_entries (user_id);

/** 大会ポイントの台帳。所持ポイントと同じく「合計＝残高」で持つ。 */
create table if not exists tournament_ledger (
  id            bigint generated always as identity primary key,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  entry_type    text not null check (entry_type in ('entry', 'bet', 'payout', 'refund')),
  amount        bigint not null,
  ref_type      text,
  ref_id        uuid,
  created_at    timestamptz not null default now()
);

create index if not exists tournament_ledger_idx
  on tournament_ledger (tournament_id, user_id);

/** 二重計上の最終防衛線。部分インデックスにしないこと（ON CONFLICT が使えなくなる）。 */
create unique index if not exists tournament_ledger_ref_uniq
  on tournament_ledger (tournament_id, ref_type, ref_id, entry_type);

/** 投票が大会のものかどうか。null なら普段の投票。 */
alter table bets add column if not exists tournament_id uuid references tournaments(id);
create index if not exists bets_tournament_idx on bets (tournament_id);

-- ---------------------------------------------------------------------
-- 参加者かどうか（ポリシーの再帰を避けるため関数にする）
-- ---------------------------------------------------------------------

create or replace function is_tournament_member(p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tournament_entries e
    where e.tournament_id = p_id and e.user_id = auth.uid()
  ) or exists (
    select 1 from tournaments t where t.id = p_id and t.owner_id = auth.uid()
  );
$$;

grant execute on function is_tournament_member(uuid) to authenticated;

alter table tournaments        enable row level security;
alter table tournament_races   enable row level security;
alter table tournament_entries enable row level security;
alter table tournament_ledger  enable row level security;

drop policy if exists tournaments_read on tournaments;
create policy tournaments_read on tournaments
  for select using (is_tournament_member(id));

drop policy if exists tournament_races_read on tournament_races;
create policy tournament_races_read on tournament_races
  for select using (is_tournament_member(tournament_id));

drop policy if exists tournament_entries_read on tournament_entries;
create policy tournament_entries_read on tournament_entries
  for select using (is_tournament_member(tournament_id));

drop policy if exists tournament_ledger_read on tournament_ledger;
create policy tournament_ledger_read on tournament_ledger
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 大会を作る
-- ---------------------------------------------------------------------

create or replace function create_tournament(
  p_name         text,
  p_entry_fee    int,
  p_days         int,             -- 1 / 7 / 14
  p_scope        text default 'selected',
  p_announcement text default '',
  p_starts_at    timestamptz default now()
)
returns table (id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_code text;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  if p_days not in (1, 7, 14) then
    raise exception '期間は1日・7日・14日のどれかです';
  end if;

  loop
    v_code := (
      select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                               (random() * 31)::int + 1, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from tournaments t where t.invite_code = v_code);
  end loop;

  insert into tournaments (name, invite_code, owner_id, announcement,
                           entry_fee, scope, starts_at, ends_at)
  values (trim(p_name), v_code, auth.uid(), coalesce(p_announcement, ''),
          p_entry_fee, p_scope, p_starts_at, p_starts_at + (p_days || ' days')::interval)
  returning tournaments.id into v_id;

  return query select v_id, v_code;
end;
$$;

grant execute on function create_tournament(text, int, int, text, text, timestamptz) to authenticated;

-- 対象レースを足す／外す（作成者だけ、開始前だけ）
create or replace function set_tournament_race(
  p_tournament_id uuid,
  p_event_id      uuid,
  p_add           boolean
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments%rowtype;
begin
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or v_t.owner_id <> auth.uid() then
    raise exception '作成者だけが変更できます';
  end if;
  if v_t.status <> 'open' then
    raise exception '始まったあとは変更できません';
  end if;

  if p_add then
    insert into tournament_races (tournament_id, event_id)
    values (p_tournament_id, p_event_id) on conflict do nothing;
  else
    delete from tournament_races
    where tournament_id = p_tournament_id and event_id = p_event_id;
  end if;
end;
$$;

grant execute on function set_tournament_race(uuid, uuid, boolean) to authenticated;

-- アナウンスを書き換える（作成者だけ）
create or replace function set_tournament_announcement(p_tournament_id uuid, p_text text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update tournaments set announcement = coalesce(p_text, '')
  where id = p_tournament_id and owner_id = auth.uid();
  if not found then raise exception '作成者だけが変更できます'; end if;
end;
$$;

grant execute on function set_tournament_announcement(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 参加する（所持ポイントから参加費を引き、大会ポイントに移す）
-- ---------------------------------------------------------------------

create or replace function join_tournament(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_t       tournaments%rowtype;
  v_season  text;
  v_balance bigint;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;

  select * into v_t from tournaments
  where upper(invite_code) = upper(trim(p_code));
  if not found then raise exception 'その招待コードの大会は見つかりません'; end if;

  if v_t.status <> 'open' or now() >= v_t.starts_at then
    raise exception 'この大会はもう始まっているので参加できません';
  end if;

  if exists (select 1 from tournament_entries e
             where e.tournament_id = v_t.id and e.user_id = auth.uid()) then
    return v_t.id;   -- すでに参加済み
  end if;

  select code into v_season from seasons
   where now() >= starts_at and now() < ends_at limit 1;
  if v_season is null then raise exception 'シーズンが開いていません'; end if;

  select coalesce(sum(amount), 0) into v_balance
    from point_ledger where user_id = auth.uid() and season_code = v_season;

  if v_balance < v_t.entry_fee then
    raise exception '参加費が足りません（必要 %pt / 持ち %pt）', v_t.entry_fee, v_balance;
  end if;

  insert into tournament_entries (tournament_id, user_id, entry_fee)
  values (v_t.id, auth.uid(), v_t.entry_fee);

  -- 所持ポイントから引く
  insert into point_ledger (user_id, season_code, entry_type, amount, ref_type, ref_id, memo)
  values (auth.uid(), v_season, 'adjust', -v_t.entry_fee, 'tournament_entry', v_t.id,
          v_t.name || ' の参加費');

  -- 大会ポイントとして配る
  insert into tournament_ledger (tournament_id, user_id, entry_type, amount, ref_type, ref_id)
  values (v_t.id, auth.uid(), 'entry', v_t.entry_fee, 'tournament', v_t.id);

  return v_t.id;
end;
$$;

grant execute on function join_tournament(text) to authenticated;

-- ---------------------------------------------------------------------
-- 大会ポイントの残高
-- ---------------------------------------------------------------------

create or replace function tournament_balance(p_tournament_id uuid, p_user_id uuid default null)
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.amount), 0)::bigint
  from tournament_ledger l
  where l.tournament_id = p_tournament_id
    and l.user_id = coalesce(p_user_id, auth.uid());
$$;

grant execute on function tournament_balance(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 投票。大会のときは大会ポイントを使う。
-- 引数が増えるので、いったん古いものを消してから作り直す。
-- ---------------------------------------------------------------------

-- 引数が変わるので古いものを消す。
-- 4引数版も消しておくと、途中で失敗しても最初からやり直せる。
drop function if exists place_bet(uuid, text, int);
drop function if exists place_bet(uuid, text, int, uuid);

create function place_bet(
  p_market_id     uuid,
  p_selection     text,
  p_stake         int,
  p_tournament_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_season  text;
  v_bet     uuid;
  v_balance bigint;
  v_market  markets%rowtype;
  v_t       tournaments%rowtype;
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
   where now() >= starts_at and now() < ends_at limit 1;
  if v_season is null then
    raise exception 'シーズンが開いていません' using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 大会の投票
  -- ------------------------------------------------------------------
  if p_tournament_id is not null then
    select * into v_t from tournaments where id = p_tournament_id;
    if not found then raise exception '大会が見つかりません' using errcode = 'P0001'; end if;

    if not exists (select 1 from tournament_entries e
                   where e.tournament_id = v_t.id and e.user_id = v_user) then
      raise exception 'この大会に参加していません' using errcode = 'P0001';
    end if;

    if now() < v_t.starts_at or now() >= v_t.ends_at or v_t.status = 'finished' then
      raise exception 'この大会は開催中ではありません' using errcode = 'P0001';
    end if;

    -- 対象レースかどうか
    if v_t.scope = 'selected' then
      if not exists (select 1 from tournament_races tr
                     where tr.tournament_id = v_t.id and tr.event_id = v_market.event_id) then
        raise exception 'このレースは大会の対象ではありません' using errcode = 'P0001';
      end if;
    else
      if v_market.closes_at < v_t.starts_at or v_market.closes_at > v_t.ends_at then
        raise exception 'このレースは大会の期間外です' using errcode = 'P0001';
      end if;
    end if;

    select coalesce(sum(amount), 0) into v_balance
      from tournament_ledger
     where tournament_id = v_t.id and user_id = v_user;

    if v_balance < p_stake then
      raise exception '大会ポイントが足りません（残り %pt）', v_balance using errcode = 'P0001';
    end if;

    insert into bets (user_id, market_id, season_code, selection, stake, tournament_id)
    values (v_user, p_market_id, v_season, p_selection, p_stake, v_t.id)
    returning id into v_bet;

    insert into tournament_ledger
      (tournament_id, user_id, entry_type, amount, ref_type, ref_id)
    values (v_t.id, v_user, 'bet', -p_stake, 'bet', v_bet);

    update markets set pool_total = pool_total + p_stake where id = p_market_id;
    return v_bet;
  end if;

  -- ------------------------------------------------------------------
  -- ふだんの投票
  -- ------------------------------------------------------------------
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

revoke all on function place_bet(uuid, text, int, uuid) from public;
grant execute on function place_bet(uuid, text, int, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 集計から大会の投票を除く
-- ふだんのランキングに大会の成績が混ざらないようにする。
-- ---------------------------------------------------------------------

drop view if exists user_season_totals;
drop view if exists user_lifetime_totals;
drop materialized view if exists user_season_stats cascade;
drop materialized view if exists user_season_races;

create materialized view user_season_stats as
select
  b.user_id, b.season_code, e.sport_code, m.bet_type_code,
  count(*)::int                                   as bet_count,
  count(*) filter (where b.status = 'won')::int   as hit_count,
  coalesce(sum(b.stake), 0)::bigint               as total_stake,
  coalesce(sum(b.payout), 0)::bigint              as total_payout,
  (coalesce(sum(b.payout), 0) - coalesce(sum(b.stake), 0))::bigint as profit
from bets b
join markets m on m.id = b.market_id
join events  e on e.id = m.event_id
where b.status in ('won', 'lost') and b.tournament_id is null
group by 1, 2, 3, 4;

create unique index user_season_stats_pk
  on user_season_stats (user_id, season_code, sport_code, bet_type_code);
create index user_season_stats_user_idx on user_season_stats (user_id);
revoke all on user_season_stats from anon, authenticated;

create materialized view user_season_races as
select
  b.user_id, b.season_code, e.sport_code,
  count(distinct m.event_id)::int as race_count,
  count(distinct m.event_id) filter (where b.status = 'won')::int as race_hit_count
from bets b
join markets m on m.id = b.market_id
join events  e on e.id = m.event_id
where b.status in ('won', 'lost') and b.tournament_id is null
group by 1, 2, 3;

create unique index user_season_races_pk
  on user_season_races (user_id, season_code, sport_code);
revoke all on user_season_races from anon, authenticated;

create view user_season_totals as
select
  s.user_id, s.season_code, s.bet_count, s.hit_count,
  s.total_stake, s.total_payout, s.profit, s.roi_pct,
  case when coalesce(r.race_count, 0) > 0
       then round(r.race_hit_count::numeric / r.race_count * 100, 1) end as hit_pct,
  coalesce(r.race_count, 0) as race_count,
  coalesce(r.race_hit_count, 0) as race_hit_count
from (
  select user_id, season_code,
         sum(bet_count)::int as bet_count, sum(hit_count)::int as hit_count,
         sum(total_stake)::bigint as total_stake, sum(total_payout)::bigint as total_payout,
         sum(profit)::bigint as profit,
         case when sum(total_stake) > 0
              then round(sum(total_payout)::numeric / sum(total_stake) * 100, 1) end as roi_pct
  from user_season_stats group by 1, 2
) s
left join (
  select user_id, season_code,
         sum(race_count)::int as race_count, sum(race_hit_count)::int as race_hit_count
  from user_season_races group by 1, 2
) r on r.user_id = s.user_id and r.season_code = s.season_code;

create view user_lifetime_totals as
select
  s.user_id, s.bet_count, s.hit_count,
  s.total_stake, s.total_payout, s.profit, s.roi_pct,
  case when coalesce(r.race_count, 0) > 0
       then round(r.race_hit_count::numeric / r.race_count * 100, 1) end as hit_pct,
  coalesce(r.race_count, 0) as race_count,
  coalesce(r.race_hit_count, 0) as race_hit_count
from (
  select user_id,
         sum(bet_count)::int as bet_count, sum(hit_count)::int as hit_count,
         sum(total_stake)::bigint as total_stake, sum(total_payout)::bigint as total_payout,
         sum(profit)::bigint as profit,
         case when sum(total_stake) > 0
              then round(sum(total_payout)::numeric / sum(total_stake) * 100, 1) end as roi_pct
  from user_season_stats group by 1
) s
left join (
  select user_id,
         sum(race_count)::int as race_count, sum(race_hit_count)::int as race_hit_count
  from user_season_races group by 1
) r on r.user_id = s.user_id;

-- user_stats はマテリアライズドビューを作り直したので張り直す。
-- 既存のものは引数にデフォルト値が付いていて replace できないため、
-- いったん消してから作る。
drop function if exists user_stats(uuid, text);

create function user_stats(p_user_id uuid, p_season_code text default null)
returns table (
  season_code   text,
  sport_code    text,
  bet_type_code text,
  bet_count     int,
  hit_count     int,
  total_stake   bigint,
  total_payout  bigint,
  profit        bigint
)
language sql stable security definer set search_path = public as $$
  select s.season_code, s.sport_code, s.bet_type_code,
         s.bet_count, s.hit_count, s.total_stake, s.total_payout, s.profit
  from user_season_stats s
  where s.user_id = p_user_id
    and (p_season_code is null or s.season_code = p_season_code)
    and can_see_user(p_user_id);
$$;

grant execute on function user_stats(uuid, text) to authenticated;

-- can_see_user から部屋の条件を外す（部屋はもうない）
create or replace function can_see_user(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_user_id = auth.uid()
    or exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = p_user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = p_user_id))
    )
    or exists (
      select 1 from tournament_entries a
      join tournament_entries b on b.tournament_id = a.tournament_id
      where a.user_id = auth.uid() and b.user_id = p_user_id
    );
$$;

grant execute on function can_see_user(uuid) to authenticated;

select refresh_user_season_stats();
