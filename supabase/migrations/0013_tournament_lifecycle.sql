-- =====================================================================
-- 大会の進行と締め
--
--   ・開始時刻を過ぎたら 'running' にする（参加受付を閉じる）
--   ・終了時刻を過ぎ、対象レースが全部確定したら 'finished' にして精算する
--   ・精算＝大会ポイントの残りをそのまま所持ポイントに戻す
--
-- 何度実行しても同じ結果になるように作ってある。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 一覧・詳細
-- ---------------------------------------------------------------------

create or replace function my_tournaments()
returns table (
  id           uuid,
  name         text,
  invite_code  text,
  owner_id     uuid,
  announcement text,
  entry_fee    int,
  scope        text,
  starts_at    timestamptz,
  ends_at      timestamptz,
  status       text,
  member_count int,
  race_count   int,
  is_owner     boolean,
  joined       boolean,
  my_points    bigint
)
language sql stable security definer set search_path = public as $$
  select
    t.id, t.name, t.invite_code, t.owner_id, t.announcement,
    t.entry_fee, t.scope, t.starts_at, t.ends_at, t.status,
    (select count(*)::int from tournament_entries e where e.tournament_id = t.id),
    (select count(*)::int from tournament_races r where r.tournament_id = t.id),
    t.owner_id = auth.uid(),
    exists (select 1 from tournament_entries e
            where e.tournament_id = t.id and e.user_id = auth.uid()),
    coalesce((select sum(l.amount) from tournament_ledger l
              where l.tournament_id = t.id and l.user_id = auth.uid()), 0)::bigint
  from tournaments t
  where t.owner_id = auth.uid()
     or exists (select 1 from tournament_entries e
                where e.tournament_id = t.id and e.user_id = auth.uid())
  order by
    case t.status when 'running' then 0 when 'open' then 1 else 2 end,
    t.starts_at desc;
$$;

grant execute on function my_tournaments() to authenticated;

-- ---------------------------------------------------------------------
-- 大会のランキング
-- 「増やした額」で並べる。全員が同じ額から始まるので、残高順と同じ。
-- ---------------------------------------------------------------------

create or replace function tournament_ranking(p_tournament_id uuid)
returns table (
  user_id      uuid,
  handle       text,
  display_name text,
  entry_fee    int,
  points       bigint,
  diff         bigint,
  bet_count    int,
  hit_count    int,
  is_me        boolean,
  is_out       boolean
)
language sql stable security definer set search_path = public as $$
  select
    e.user_id,
    p.handle,
    p.display_name,
    e.entry_fee,
    coalesce(e.final_points,
      (select sum(l.amount) from tournament_ledger l
       where l.tournament_id = e.tournament_id and l.user_id = e.user_id), 0)::bigint as points,
    coalesce(e.final_points,
      (select sum(l.amount) from tournament_ledger l
       where l.tournament_id = e.tournament_id and l.user_id = e.user_id), 0)::bigint
      - e.entry_fee as diff,
    (select count(*)::int from bets b
     where b.tournament_id = e.tournament_id and b.user_id = e.user_id),
    (select count(*)::int from bets b
     where b.tournament_id = e.tournament_id and b.user_id = e.user_id and b.status = 'won'),
    e.user_id = auth.uid(),
    coalesce(e.final_points,
      (select sum(l.amount) from tournament_ledger l
       where l.tournament_id = e.tournament_id and l.user_id = e.user_id), 0) <= 0
  from tournament_entries e
  join profiles p on p.id = e.user_id
  where e.tournament_id = p_tournament_id
    and is_tournament_member(p_tournament_id)
  order by 6 desc;
$$;

grant execute on function tournament_ranking(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 大会の対象レース一覧
-- ---------------------------------------------------------------------

create or replace function tournament_race_list(p_tournament_id uuid)
returns table (
  event_id    uuid,
  title       text,
  venue_name  text,
  venue_code  text,
  race_number int,
  deadline_at timestamptz,
  status      text
)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.venue_name, e.venue_code, e.race_number, e.deadline_at, e.status
  from tournament_races r
  join events e on e.id = r.event_id
  where r.tournament_id = p_tournament_id
    and is_tournament_member(p_tournament_id)
  order by e.deadline_at;
$$;

grant execute on function tournament_race_list(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 進行と締め（取り込みワーカーから呼ぶ）
-- ---------------------------------------------------------------------

create or replace function advance_tournaments()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_t       record;
  v_e       record;
  v_season  text;
  v_points  bigint;
  v_done    int := 0;
  v_pending int;
begin
  -- 開始したものを running に
  update tournaments set status = 'running'
  where status = 'open' and now() >= starts_at;

  -- 参加者が0人のまま始まったものは中止にする
  update tournaments t set status = 'cancelled'
  where t.status = 'running'
    and now() >= t.ends_at
    and not exists (select 1 from tournament_entries e where e.tournament_id = t.id);

  select code into v_season from seasons
   where now() >= starts_at and now() < ends_at limit 1;

  for v_t in
    select * from tournaments
    where status = 'running' and now() >= ends_at
  loop
    -- 対象レースがまだ精算されていないなら待つ。
    -- 大会の投票が1つでも結果待ちなら締めない。
    select count(*) into v_pending
    from bets b where b.tournament_id = v_t.id and b.status = 'placed';
    if v_pending > 0 then
      continue;
    end if;

    for v_e in
      select * from tournament_entries where tournament_id = v_t.id and settled_at is null
    loop
      select coalesce(sum(l.amount), 0) into v_points
      from tournament_ledger l
      where l.tournament_id = v_t.id and l.user_id = v_e.user_id;

      -- 残った大会ポイントを所持ポイントに戻す
      if v_points > 0 and v_season is not null then
        insert into point_ledger
          (user_id, season_code, entry_type, amount, ref_type, ref_id, memo)
        values (v_e.user_id, v_season, 'adjust', v_points,
                'tournament_payout', v_t.id, v_t.name || ' の結果')
        on conflict do nothing;
      end if;

      update tournament_entries
      set final_points = v_points, settled_at = now()
      where tournament_id = v_t.id and user_id = v_e.user_id;

      v_done := v_done + 1;
    end loop;

    update tournaments set status = 'finished' where id = v_t.id;
  end loop;

  return v_done;
end;
$$;

revoke all on function advance_tournaments() from public;
grant execute on function advance_tournaments() to service_role;

-- 所持ポイントに戻すときの二重計上を防ぐ
create unique index if not exists point_ledger_tournament_uniq
  on point_ledger (user_id, ref_type, ref_id)
  where ref_type in ('tournament_entry', 'tournament_payout');
