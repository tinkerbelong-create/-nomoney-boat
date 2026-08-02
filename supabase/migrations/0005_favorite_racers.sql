-- =====================================================================
-- お気に入り選手
--
--   ・1人あたり10人まで
--   ・お気に入り選手が出ているレースには一覧で★を出す
--
-- 選手は登録番号（4桁のtoban）で覚える。名前は表示用の控えなので、
-- 改名があっても登録番号で追い続けられる。
-- =====================================================================

create table if not exists favorite_racers (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  racer_id   text        not null,
  name       text        not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, racer_id)
);

alter table favorite_racers enable row level security;

drop policy if exists favorite_racers_own on favorite_racers;
create policy favorite_racers_own on favorite_racers
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 10人までの上限。アプリ側だけで数えると、同時に2回押されたときに抜けるので
-- データベース側でも止める。
create or replace function enforce_favorite_racer_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from favorite_racers where user_id = new.user_id) >= 10 then
    raise exception 'お気に入り選手は10人までです';
  end if;
  return new;
end;
$$;

drop trigger if exists favorite_racers_limit on favorite_racers;
create trigger favorite_racers_limit
  before insert on favorite_racers
  for each row execute function enforce_favorite_racer_limit();

-- 出走表を登録番号で引くための索引
create index if not exists event_entrants_racer_idx
  on event_entrants ((meta->>'racerId'));

-- ---------------------------------------------------------------------
-- 指定したレースのうち、自分のお気に入り選手が出ているものを返す。
--
-- event_entrants と favorite_racers をまたぐので、行レベルセキュリティを
-- 素直に効かせたままだと結合できない。SECURITY DEFINER にしたうえで、
-- 中で auth.uid() を使って必ず自分のお気に入りだけを見るようにしている。
-- ---------------------------------------------------------------------
create or replace function my_favorite_events(p_event_ids uuid[])
returns table (event_id uuid, racer_names text[])
language sql
stable
security definer
set search_path = public
as $$
  select ee.event_id, array_agg(distinct ee.name order by ee.name)
  from event_entrants ee
  join favorite_racers f
    on f.racer_id = ee.meta->>'racerId'
   and f.user_id = auth.uid()
  where ee.event_id = any(p_event_ids)
  group by ee.event_id;
$$;

revoke all on function my_favorite_events(uuid[]) from public;
grant execute on function my_favorite_events(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 選手を名前または登録番号で探す。
-- 出走表に載ったことのある選手だけが対象。
-- ---------------------------------------------------------------------
create or replace function search_racers(p_query text, p_limit int default 30)
returns table (racer_id text, name text, racer_class text, last_seen timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    ee.meta->>'racerId'    as racer_id,
    max(ee.name)           as name,
    max(ee.meta->>'racerClass') as racer_class,
    max(e.deadline_at)     as last_seen
  from event_entrants ee
  join events e on e.id = ee.event_id
  where ee.meta->>'racerId' is not null
    and (
      ee.name ilike '%' || p_query || '%'
      or replace(ee.name, ' ', '') ilike '%' || replace(p_query, ' ', '') || '%'
      or ee.meta->>'racerId' = p_query
    )
  group by ee.meta->>'racerId'
  order by max(e.deadline_at) desc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function search_racers(text, int) from public;
grant execute on function search_racers(text, int) to authenticated;
