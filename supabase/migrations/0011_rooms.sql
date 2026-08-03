-- =====================================================================
-- 部屋（グループ）
--
-- LINEのグループのようなもの。招待コードで入る。
-- ポイントは1人1つの残高を共用し、部屋は「誰と比べるか」を変えるだけ。
-- こうしておくと、複数の部屋に入っても混乱しないし、
-- 今の投票・精算の仕組みを一切壊さずに済む。
-- =====================================================================

create table if not exists rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 30),
  invite_code text not null unique,
  owner_id    uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists room_members (
  room_id   uuid not null references rooms(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on room_members (user_id);

create table if not exists room_messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists room_messages_room_idx on room_messages (room_id, created_at desc);

-- 部屋ごとの月間タイトル（王者など）
create table if not exists room_titles (
  room_id     uuid not null references rooms(id) on delete cascade,
  season_code text not null,
  kind        text not null check (kind in ('champion', 'hit', 'roi', 'loser')),
  user_id     uuid not null references profiles(id) on delete cascade,
  awarded_at  timestamptz not null default now(),
  primary key (room_id, season_code, kind)
);

alter table rooms         enable row level security;
alter table room_members  enable row level security;
alter table room_messages enable row level security;
alter table room_titles   enable row level security;

-- ---------------------------------------------------------------------
-- 「その部屋の一員かどうか」を判定する関数。
--
-- ポリシーの中で room_members を直接参照すると、
-- room_members 自身のポリシーがまた room_members を見て無限に回る。
-- SECURITY DEFINER の関数にして、ポリシーの再帰を断ち切る。
-- ---------------------------------------------------------------------
create or replace function is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_members m
    where m.room_id = p_room_id and m.user_id = auth.uid()
  );
$$;

grant execute on function is_room_member(uuid) to authenticated;

drop policy if exists rooms_read on rooms;
create policy rooms_read on rooms for select using (is_room_member(id));

drop policy if exists room_members_read on room_members;
create policy room_members_read on room_members
  for select using (is_room_member(room_id));

drop policy if exists room_messages_read on room_messages;
create policy room_messages_read on room_messages
  for select using (is_room_member(room_id));

drop policy if exists room_messages_write on room_messages;
create policy room_messages_write on room_messages
  for insert with check (user_id = auth.uid() and is_room_member(room_id));

drop policy if exists room_messages_delete on room_messages;
create policy room_messages_delete on room_messages
  for delete using (user_id = auth.uid());

drop policy if exists room_titles_read on room_titles;
create policy room_titles_read on room_titles
  for select using (is_room_member(room_id));

-- ---------------------------------------------------------------------
-- 部屋を作る
-- ---------------------------------------------------------------------

create or replace function create_room(p_name text)
returns table (id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください';
  end if;

  if (select count(*) from room_members where user_id = auth.uid()) >= 20 then
    raise exception '入れる部屋は20個までです';
  end if;

  -- 招待コード。読み間違えやすい文字（0/O/1/I）は使わない。
  loop
    v_code := (
      select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                               (random() * 31)::int + 1, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from rooms r where r.invite_code = v_code);
  end loop;

  insert into rooms (name, invite_code, owner_id)
  values (trim(p_name), v_code, auth.uid())
  returning rooms.id into v_id;

  insert into room_members (room_id, user_id, role) values (v_id, auth.uid(), 'owner');

  return query select v_id, trim(p_name), v_code;
end;
$$;

grant execute on function create_room(text) to authenticated;

-- ---------------------------------------------------------------------
-- 招待コードで入る
-- ---------------------------------------------------------------------

create or replace function join_room(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください';
  end if;

  select r.id into v_id from rooms r
  where upper(r.invite_code) = upper(trim(p_code));

  if v_id is null then
    raise exception 'その招待コードの部屋は見つかりません';
  end if;

  if (select count(*) from room_members m where m.room_id = v_id) >= 50 then
    raise exception 'この部屋は満員です（50人まで）';
  end if;

  insert into room_members (room_id, user_id) values (v_id, auth.uid())
  on conflict do nothing;

  return v_id;
end;
$$;

grant execute on function join_room(text) to authenticated;

-- ---------------------------------------------------------------------
-- 部屋を出る（作った人は出られない）
-- ---------------------------------------------------------------------

create or replace function leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from rooms r where r.id = p_room_id and r.owner_id = auth.uid()) then
    raise exception '部屋を作った人は出られません';
  end if;
  delete from room_members where room_id = p_room_id and user_id = auth.uid();
end;
$$;

grant execute on function leave_room(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 自分が入っている部屋の一覧
-- ---------------------------------------------------------------------

create or replace function my_rooms()
returns table (
  id           uuid,
  name         text,
  invite_code  text,
  member_count int,
  is_owner     boolean,
  last_message text,
  last_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.name,
    r.invite_code,
    (select count(*)::int from room_members m2 where m2.room_id = r.id),
    r.owner_id = auth.uid(),
    (select msg.body from room_messages msg
      where msg.room_id = r.id order by msg.created_at desc limit 1),
    (select msg.created_at from room_messages msg
      where msg.room_id = r.id order by msg.created_at desc limit 1)
  from rooms r
  join room_members m on m.room_id = r.id and m.user_id = auth.uid()
  order by r.created_at;
$$;

grant execute on function my_rooms() to authenticated;

-- ---------------------------------------------------------------------
-- 部屋のランキング
-- ---------------------------------------------------------------------

create or replace function room_ranking(
  p_room_id     uuid,
  p_season_code text,     -- null なら通算
  p_metric      text      -- 'profit' | 'roi' | 'hit'
)
returns table (
  user_id        uuid,
  handle         text,
  display_name   text,
  bet_count      int,
  total_stake    bigint,
  total_payout   bigint,
  profit         bigint,
  roi_pct        numeric,
  hit_pct        numeric,
  race_count     int,
  race_hit_count int,
  is_me          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with stats as (
    select t.user_id, t.bet_count, t.total_stake, t.total_payout,
           t.profit, t.roi_pct, t.hit_pct, t.race_count, t.race_hit_count
    from user_season_totals t
    where p_season_code is not null and t.season_code = p_season_code
    union all
    select l.user_id, l.bet_count, l.total_stake, l.total_payout,
           l.profit, l.roi_pct, l.hit_pct, l.race_count, l.race_hit_count
    from user_lifetime_totals l
    where p_season_code is null
  )
  select
    m.user_id,
    p.handle,
    p.display_name,
    coalesce(s.bet_count, 0),
    coalesce(s.total_stake, 0::bigint),
    coalesce(s.total_payout, 0::bigint),
    coalesce(s.profit, 0::bigint),
    s.roi_pct,
    s.hit_pct,
    coalesce(s.race_count, 0),
    coalesce(s.race_hit_count, 0),
    m.user_id = auth.uid()
  from room_members m
  join profiles p on p.id = m.user_id
  left join stats s on s.user_id = m.user_id
  where m.room_id = p_room_id
    and is_room_member(p_room_id)
  order by
    case when p_metric = 'roi'  then s.roi_pct end desc nulls last,
    case when p_metric = 'hit'  then s.hit_pct end desc nulls last,
    case when p_metric = 'profit' then coalesce(s.profit, 0::bigint) end desc nulls last;
$$;

grant execute on function room_ranking(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 部屋のタイムライン（締切後の投票だけ）
-- ---------------------------------------------------------------------

create or replace function room_timeline(p_room_id uuid, p_limit int default 200)
returns table (
  bet_id        uuid,
  user_id       uuid,
  handle        text,
  display_name  text,
  event_id      uuid,
  event_title   text,
  venue_name    text,
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
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.user_id, p.handle, p.display_name,
    e.id, e.title, e.venue_name, e.race_number,
    e.deadline_at, e.status,
    m.bet_type_code, b.selection, b.stake, b.status, b.payout,
    coalesce(b.settled_at, m.closes_at)
  from bets b
  join markets  m on m.id = b.market_id
  join events   e on e.id = m.event_id
  join profiles p on p.id = b.user_id
  join room_members rm on rm.user_id = b.user_id and rm.room_id = p_room_id
  where m.closes_at <= now()
    and is_room_member(p_room_id)
  order by coalesce(b.settled_at, m.closes_at) desc
  limit p_limit;
$$;

grant execute on function room_timeline(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 部屋の月間タイトル（月初に前月ぶんを発行）
-- ---------------------------------------------------------------------

create or replace function award_room_titles(p_season_code text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room record;
  v_n int := 0;
begin
  for v_room in select id from rooms loop
    -- 収支1位
    insert into room_titles (room_id, season_code, kind, user_id)
    select v_room.id, p_season_code, 'champion', t.user_id
    from user_season_totals t
    join room_members m on m.user_id = t.user_id and m.room_id = v_room.id
    where t.season_code = p_season_code and t.race_count > 0
    order by t.profit desc limit 1
    on conflict do nothing;

    -- 的中率1位（10レース以上）
    insert into room_titles (room_id, season_code, kind, user_id)
    select v_room.id, p_season_code, 'hit', t.user_id
    from user_season_totals t
    join room_members m on m.user_id = t.user_id and m.room_id = v_room.id
    where t.season_code = p_season_code and t.race_count >= 10 and t.hit_pct is not null
    order by t.hit_pct desc limit 1
    on conflict do nothing;

    -- 回収率1位（10レース以上）
    insert into room_titles (room_id, season_code, kind, user_id)
    select v_room.id, p_season_code, 'roi', t.user_id
    from user_season_totals t
    join room_members m on m.user_id = t.user_id and m.room_id = v_room.id
    where t.season_code = p_season_code and t.race_count >= 10 and t.roi_pct is not null
    order by t.roi_pct desc limit 1
    on conflict do nothing;

    -- 大敗王（2人以上いるときだけ）
    insert into room_titles (room_id, season_code, kind, user_id)
    select v_room.id, p_season_code, 'loser', t.user_id
    from user_season_totals t
    join room_members m on m.user_id = t.user_id and m.room_id = v_room.id
    where t.season_code = p_season_code and t.race_count > 0
      and (select count(*) from room_members m2 where m2.room_id = v_room.id) >= 2
    order by t.profit asc limit 1
    on conflict do nothing;
  end loop;

  select count(*) into v_n from room_titles where season_code = p_season_code;
  return v_n;
end;
$$;

revoke all on function award_room_titles(text) from public;
grant execute on function award_room_titles(text) to service_role;

-- ---------------------------------------------------------------------
-- プロフィール表示用：その人の月間成績・称号・部屋タイトル
-- 自分か、フレンドか、同じ部屋の人だけ見られる。
-- ---------------------------------------------------------------------

create or replace function can_see_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id = auth.uid()
    or exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = p_user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = p_user_id))
    )
    or exists (
      select 1 from room_members a
      join room_members b on b.room_id = a.room_id
      where a.user_id = auth.uid() and b.user_id = p_user_id
    );
$$;

grant execute on function can_see_user(uuid) to authenticated;

-- 称号一覧を「同じ部屋の人」にも見せる
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
  where can_see_user(p_user_id)
  order by (ub.earned_at is null), b.sort_order, b.code;
$$;

grant execute on function user_badge_list(uuid) to authenticated;

-- その人の直近の的中（プロフィールの見どころ）
create or replace function user_recent_hits(p_user_id uuid, p_limit int default 10)
returns table (
  bet_id        uuid,
  event_id      uuid,
  venue_name    text,
  race_number   int,
  deadline_at   timestamptz,
  bet_type_code text,
  selection     text,
  stake         int,
  payout        bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, e.id, e.venue_name, e.race_number, e.deadline_at,
         m.bet_type_code, b.selection, b.stake, b.payout
  from bets b
  join markets m on m.id = b.market_id
  join events  e on e.id = m.event_id
  where b.user_id = p_user_id
    and b.status = 'won'
    and can_see_user(p_user_id)
  order by b.payout desc, b.settled_at desc
  limit p_limit;
$$;

grant execute on function user_recent_hits(uuid, int) to authenticated;

-- その人の月ごとの成績（プロフィールの推移）
create or replace function user_monthly(p_user_id uuid)
returns table (
  season_code    text,
  race_count     int,
  race_hit_count int,
  profit         bigint,
  roi_pct        numeric,
  hit_pct        numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select t.season_code, t.race_count, t.race_hit_count, t.profit, t.roi_pct, t.hit_pct
  from user_season_totals t
  where t.user_id = p_user_id and can_see_user(p_user_id)
  order by t.season_code desc;
$$;

grant execute on function user_monthly(uuid) to authenticated;
