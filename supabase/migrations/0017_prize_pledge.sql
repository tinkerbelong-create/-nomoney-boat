-- =====================================================================
-- 景品は主催者の全額自己負担
--
-- 「ホストが全部自腹」を、書き置きではなく仕組みとして固める。
--
--   ・景品を保存するには、毎回その場で誓約に同意しないといけない
--   ・同意した文面・そのときの景品・日時を、消せない記録として残す
--   ・同意の記録は参加者全員が見られる（主催者だけの秘密にしない）
--
-- なぜここまでするか。
-- 参加者から集めたものが優勝者に渡る形は賭博になる。
-- 「主催者が自分で出す」という一点だけが、この機能を安全側に置いている。
-- だから、その一点は口約束ではなく記録にする。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 誓約の記録（追記だけ。書き換えも削除もしない）
-- ---------------------------------------------------------------------

create table if not exists tournament_prize_pledges (
  id            bigint generated always as identity primary key,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  /** 同意した文面をそのまま保存する。あとで文面を変えても、当時の約束が残る。 */
  pledge_text   text not null,
  /** そのとき何を景品にしたか */
  prize_1       text not null default '',
  prize_2       text not null default '',
  prize_3       text not null default '',
  agreed_at     timestamptz not null default now()
);

create index if not exists tournament_prize_pledges_idx
  on tournament_prize_pledges (tournament_id, agreed_at desc);

alter table tournament_prize_pledges enable row level security;

-- 参加者は誰でも読める。「主催者が自腹だと約束した」ことは、
-- 参加を決める人が確認できないと意味がない。
drop policy if exists tournament_prize_pledges_read on tournament_prize_pledges;
create policy tournament_prize_pledges_read on tournament_prize_pledges
  for select using (is_tournament_member(tournament_id));

-- 書き込みは関数からだけ（security definer）。直接の insert / update / delete は許さない。
revoke insert, update, delete on tournament_prize_pledges from authenticated;

-- ---------------------------------------------------------------------
-- 景品を書く（同意なしでは書けない）
--
-- 引数が増えるので作り直す。
-- ---------------------------------------------------------------------

drop function if exists set_tournament_prizes(uuid, text, text, text);

create or replace function set_tournament_prizes(
  p_tournament_id uuid,
  p_1             text,
  p_2             text,
  p_3             text,
  p_agreed        boolean,
  p_pledge_text   text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments%rowtype;
  v_1 text := trim(coalesce(p_1, ''));
  v_2 text := trim(coalesce(p_2, ''));
  v_3 text := trim(coalesce(p_3, ''));
  v_any boolean;
begin
  select * into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception '大会が見つかりません'; end if;
  if v_t.owner_id <> auth.uid() then
    raise exception '主催者だけが景品を決められます';
  end if;
  if v_t.status in ('finished', 'cancelled') then
    raise exception '終わった大会の景品は変えられません';
  end if;

  v_any := (v_1 <> '' or v_2 <> '' or v_3 <> '');

  -- 景品を1つでも書くなら、同意は必須。
  if v_any then
    if coalesce(p_agreed, false) is not true then
      raise exception '景品を決めるには、全額を自分で負担することへの同意が必要です';
    end if;
    if coalesce(trim(p_pledge_text), '') = '' then
      raise exception '同意した文面が空です';
    end if;

    insert into tournament_prize_pledges
      (tournament_id, user_id, pledge_text, prize_1, prize_2, prize_3)
    values (p_tournament_id, auth.uid(), p_pledge_text, v_1, v_2, v_3);
  end if;

  update tournaments
     set prize_1 = v_1,
         prize_2 = v_2,
         prize_3 = v_3,
         prizes_agreed_at = case when v_any then now() else null end
   where id = p_tournament_id;
end;
$$;

grant execute on function set_tournament_prizes(uuid, text, text, text, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 最新の誓約を1件返す（大会ページで見せる）
-- ---------------------------------------------------------------------

create or replace function tournament_pledge(p_tournament_id uuid)
returns table (
  display_name text,
  handle       text,
  pledge_text  text,
  agreed_at    timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.display_name, p.handle, g.pledge_text, g.agreed_at
  from tournament_prize_pledges g
  join profiles p on p.id = g.user_id
  where g.tournament_id = p_tournament_id
    and is_tournament_member(p_tournament_id)
  order by g.agreed_at desc
  limit 1;
$$;

grant execute on function tournament_pledge(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 一覧に「主催者の名前」と「同意した日時」を足す
-- ---------------------------------------------------------------------

drop function if exists my_tournaments();

create or replace function my_tournaments()
returns table (
  id               uuid,
  name             text,
  invite_code      text,
  owner_id         uuid,
  owner_name       text,
  announcement     text,
  entry_fee        int,
  scope            text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  status           text,
  prize_1          text,
  prize_2          text,
  prize_3          text,
  prizes_agreed_at timestamptz,
  member_count     int,
  race_count       int,
  is_owner         boolean,
  joined           boolean,
  my_points        bigint
)
language sql stable security definer set search_path = public as $$
  select
    t.id, t.name, t.invite_code, t.owner_id,
    (select o.display_name from profiles o where o.id = t.owner_id),
    t.announcement,
    t.entry_fee, t.scope, t.starts_at, t.ends_at, t.status,
    t.prize_1, t.prize_2, t.prize_3, t.prizes_agreed_at,
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
