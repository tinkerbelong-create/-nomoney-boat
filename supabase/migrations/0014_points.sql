-- =====================================================================
-- ポイント制度の変更
--
--   これまで： 毎月1日に50,000pt。月末で締めて翌月リセット
--   これから： 入会時に50,000pt（1回だけ）。以後リセットなし
--             毎週木曜日に5,000ptを配る
--
-- 「毎週もらえる日がある」ほうが、開く理由になる。
-- リセットをやめたので、残高は台帳の全部の合計になる。
--
-- 月ごとの成績（ランキングの「今月」）はこれまでどおり残す。
-- 残高と成績は別のものとして扱う。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 残高：シーズンで区切らず、台帳の全部を足す
-- ---------------------------------------------------------------------

drop view if exists current_balances;

-- security_invoker を付けるのが重要。
-- これがないとビューは作成者の権限で動き、point_ledger の行レベル
-- セキュリティを素通りして「全員の残高」が誰にでも見えてしまう。
create view current_balances with (security_invoker = on) as
select
  l.user_id,
  coalesce(sum(l.amount), 0)::bigint as balance
from point_ledger l
group by l.user_id;

-- ---------------------------------------------------------------------
-- 入会ボーナス 50,000pt（1人1回だけ）
-- ---------------------------------------------------------------------

create unique index if not exists point_ledger_signup_uniq
  on point_ledger (user_id) where entry_type = 'signup';

/** 入会ボーナスを配る。すでに受け取っていれば何もしない。 */
create or replace function grant_signup_bonus(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_season text;
begin
  select code into v_season from seasons
   where now() >= starts_at and now() < ends_at limit 1;
  if v_season is null then
    select code into v_season from seasons order by starts_at desc limit 1;
  end if;
  if v_season is null then return; end if;

  insert into point_ledger (user_id, season_code, entry_type, amount, memo)
  values (p_user_id, v_season, 'signup', 50000, '入会ボーナス')
  on conflict do nothing;
end;
$$;

grant execute on function grant_signup_bonus(uuid) to authenticated, service_role;

/** プロフィールを作ったら自動で配る */
create or replace function on_profile_created()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform grant_signup_bonus(new.id);
  return new;
end;
$$;

drop trigger if exists profiles_signup_bonus on profiles;
create trigger profiles_signup_bonus
  after insert on profiles
  for each row execute function on_profile_created();

-- ---------------------------------------------------------------------
-- 毎週木曜日 5,000pt
--
-- 「その週の木曜日」を文字（例 '2026-08-06'）にして memo に入れ、
-- 同じ週に二度配られないようにする。
-- ---------------------------------------------------------------------

create unique index if not exists point_ledger_weekly_uniq
  on point_ledger (user_id, memo) where entry_type = 'weekly';

/**
 * 木曜日なら全員に5,000ptを配る。木曜以外の日は何もしない。
 * 何度呼んでも、その週のぶんは1回しか配られない。
 */
create or replace function grant_weekly_points()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today  date := (now() at time zone 'Asia/Tokyo')::date;
  v_season text;
  v_key    text;
  v_n      int;
begin
  -- ISO の曜日は 月=1 … 木=4
  if extract(isodow from v_today) <> 4 then
    return 0;
  end if;

  select code into v_season from seasons
   where now() >= starts_at and now() < ends_at limit 1;
  if v_season is null then
    select code into v_season from seasons order by starts_at desc limit 1;
  end if;
  if v_season is null then return 0; end if;

  v_key := to_char(v_today, 'YYYY-MM-DD');

  insert into point_ledger (user_id, season_code, entry_type, amount, memo)
  select p.id, v_season, 'weekly', 5000, v_key
  from profiles p
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function grant_weekly_points() from public;
grant execute on function grant_weekly_points() to service_role;

-- ---------------------------------------------------------------------
-- entry_type に新しい種類を足す
-- ---------------------------------------------------------------------

alter table point_ledger drop constraint if exists point_ledger_entry_type_check;
alter table point_ledger add constraint point_ledger_entry_type_check
  check (entry_type in ('grant', 'signup', 'weekly', 'bet', 'payout', 'refund', 'adjust'));

-- ---------------------------------------------------------------------
-- シーズンを先まで作っておく
--
-- シーズンはもう「リセットの単位」ではなく、成績を月ごとに数えるための
-- ただの区切り。切れると投票できなくなるので、2年ぶん先に作っておく。
-- ---------------------------------------------------------------------

insert into seasons (code, starts_at, ends_at, grant_amount)
select
  to_char(m, 'YYYY-MM'),
  m,
  m + interval '1 month',
  0
from generate_series(
  date_trunc('month', now() at time zone 'Asia/Tokyo'),
  date_trunc('month', now() at time zone 'Asia/Tokyo') + interval '24 months',
  interval '1 month'
) as m
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- いまいる人にも入会ボーナスを配る（まだ持っていない人だけ）
-- ---------------------------------------------------------------------

select grant_signup_bonus(id) from profiles;
