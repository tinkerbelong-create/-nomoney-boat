-- =====================================================================
-- お題レース：払戻2倍をやめて「3割キャッシュバック」にする
--
--   これまで： 払戻が2倍。ただし1人5,000ptまで
--   これから： 払戻はふつうどおり。上限なし
--             賭けた額の30%が必ず戻る（当たっても外れても）
--             戻る額は1レース10,000ptまで
--
-- 【なぜ変えるか】
-- 「ここは勝負だ」と思ったレースで5,000ptしか賭けられないのが窮屈だった。
-- 上限を外し、代わりにキャッシュバックで下ぶれをやわらげる。
-- 大きく張っても3割は返ってくるので、思い切って勝負できる。
--
-- キャッシュバックは精算のときに1レースぶんまとめて記帳する。
-- 何度精算をやり直しても二重に配られない。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 賭け金の上限をなくす
--
-- 列を消す前に、その列を読んでいるトリガーを外すこと。
-- ---------------------------------------------------------------------

drop trigger if exists bets_daily_feature_cap on bets;
drop function if exists enforce_daily_feature_cap();

-- ---------------------------------------------------------------------
-- daily_features の作り直し
-- ---------------------------------------------------------------------

alter table daily_features
  add column if not exists cashback_rate numeric not null default 0.30,
  add column if not exists cashback_max  int     not null default 10000;

alter table daily_features drop constraint if exists daily_features_rate_check;
alter table daily_features add constraint daily_features_rate_check
  check (cashback_rate >= 0 and cashback_rate <= 1);

-- today_feature() が返しているので、先に関数を消す
drop function if exists today_feature();

alter table daily_features drop column if exists multiplier;
alter table daily_features drop column if exists max_stake;

-- ---------------------------------------------------------------------
-- 今日のお題を1件返す
-- ---------------------------------------------------------------------

create or replace function today_feature()
returns table (
  event_id      uuid,
  race_date     date,
  cashback_rate numeric,
  cashback_max  int,
  title         text,
  venue_name    text,
  venue_code    text,
  race_number   int,
  deadline_at   timestamptz,
  status        text,
  my_stake      int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.event_id,
    f.race_date,
    f.cashback_rate,
    f.cashback_max,
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
      where m.event_id = f.event_id
        and b.user_id = auth.uid()
        and b.tournament_id is null
        and b.status <> 'refunded'
    ), 0)
  from daily_features f
  join events e on e.id = f.event_id
  where f.race_date = (now() at time zone 'Asia/Tokyo')::date
  limit 1;
$$;

grant execute on function today_feature() to authenticated;

-- ---------------------------------------------------------------------
-- キャッシュバック
-- ---------------------------------------------------------------------

alter table point_ledger drop constraint if exists point_ledger_entry_type_check;
alter table point_ledger add constraint point_ledger_entry_type_check
  check (entry_type in
    ('grant', 'signup', 'weekly', 'cashback', 'bet', 'payout', 'refund', 'adjust'));

-- 1人1レース1回だけ。
--
-- 既存の point_ledger_ref_uniq は (ref_type, ref_id, entry_type) で
-- user_id を含まないため、そのまま使うと「最初の1人しか受け取れない」
-- ことになる。キャッシュバックの行は ref_type を null にして
-- そちらの索引に引っかからないようにし、この索引だけで重複を防ぐ。
create unique index if not exists point_ledger_cashback_uniq
  on point_ledger (user_id, ref_id) where entry_type = 'cashback';

/**
 * お題レースのキャッシュバックを配る。
 *
 * 賭けた額の cashback_rate 倍を、cashback_max を上限に返す。
 * 当たり外れは見ない。返還になった投票と大会の投票は数えない。
 * 何度呼んでも、1人につき1回しか配られない。
 */
create or replace function grant_feature_cashback(p_event_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric;
  v_max  int;
  v_n    int;
begin
  select f.cashback_rate, f.cashback_max into v_rate, v_max
  from daily_features f where f.event_id = p_event_id;

  if v_rate is null then return 0; end if;   -- お題レースではない

  insert into point_ledger (user_id, season_code, entry_type, amount, ref_type, ref_id, memo)
  select
    b.user_id,
    max(b.season_code),
    'cashback',
    least(floor(sum(b.stake) * v_rate), v_max)::bigint,
    null,
    p_event_id,
    'お題レースのキャッシュバック'
  from bets b
  join markets m on m.id = b.market_id
  where m.event_id = p_event_id
    and b.tournament_id is null
    and b.status <> 'refunded'
  group by b.user_id
  having floor(sum(b.stake) * v_rate) >= 1
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function grant_feature_cashback(uuid) from public;
grant execute on function grant_feature_cashback(uuid) to service_role;

-- ---------------------------------------------------------------------
-- すでに決まっている今日ぶんの設定をそろえる
-- ---------------------------------------------------------------------

update daily_features
   set cashback_rate = 0.30, cashback_max = 10000
 where race_date >= (now() at time zone 'Asia/Tokyo')::date;
