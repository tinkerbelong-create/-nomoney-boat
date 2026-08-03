-- =====================================================================
-- 大会の景品
--
-- 主催者が1位・2位・3位の景品を自由に書ける。
--
-- 【大事な線引き】
-- サイトは景品を「表示するだけ」。用意も受け渡しも一切しない。
-- 参加費（ポイント）と景品はつながっていない。景品は主催者が自分で出す。
--
-- 現金・ギフト券・電子マネー・換金できるものは書けない。
-- これは画面で警告を出すだけでなく、保存のたびに
-- prizes_agreed_at に日時を残して「主催者が承知のうえで書いた」記録にする。
--
-- 参加者から集めたものが優勝者に渡る形にすると賭博になる。
-- この機能はそこには絶対に踏み込まない。
-- =====================================================================

alter table tournaments
  add column if not exists prize_1 text not null default '',
  add column if not exists prize_2 text not null default '',
  add column if not exists prize_3 text not null default '',
  add column if not exists prizes_agreed_at timestamptz;

alter table tournaments drop constraint if exists tournaments_prize_len_check;
alter table tournaments add constraint tournaments_prize_len_check
  check (
    char_length(prize_1) <= 60 and
    char_length(prize_2) <= 60 and
    char_length(prize_3) <= 60
  );

-- ---------------------------------------------------------------------
-- 景品を書く（主催者だけ・終了前だけ）
--
-- 終わったあとに景品を書き換えられると揉めるので、
-- finished / cancelled になったら編集できない。
-- ---------------------------------------------------------------------

create or replace function set_tournament_prizes(
  p_tournament_id uuid,
  p_1 text default '',
  p_2 text default '',
  p_3 text default ''
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments%rowtype;
  v_1 text := trim(coalesce(p_1, ''));
  v_2 text := trim(coalesce(p_2, ''));
  v_3 text := trim(coalesce(p_3, ''));
begin
  select * into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception '大会が見つかりません'; end if;
  if v_t.owner_id <> auth.uid() then
    raise exception '主催者だけが景品を決められます';
  end if;
  if v_t.status in ('finished', 'cancelled') then
    raise exception '終わった大会の景品は変えられません';
  end if;

  update tournaments
     set prize_1 = v_1,
         prize_2 = v_2,
         prize_3 = v_3,
         -- 何か書いたときだけ「承知した」印を残す。全部消したら印も消す。
         prizes_agreed_at = case
           when v_1 <> '' or v_2 <> '' or v_3 <> '' then now()
           else null
         end
   where id = p_tournament_id;
end;
$$;

grant execute on function set_tournament_prizes(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 一覧に景品を足す
--
-- 返す列が増えるので、create or replace ではなく作り直す。
-- ---------------------------------------------------------------------

drop function if exists my_tournaments();

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
  prize_1      text,
  prize_2      text,
  prize_3      text,
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
    t.prize_1, t.prize_2, t.prize_3,
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
