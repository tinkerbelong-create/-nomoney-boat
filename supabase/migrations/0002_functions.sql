-- =====================================================================
-- 運用系の関数
-- =====================================================================

-- 集計の作り直し（ingest ワーカーが精算後に呼ぶ）
--
-- CONCURRENTLY はトランザクション内で実行できず、関数の本体は常に
-- トランザクション内なので使えない。通常の REFRESH は更新中テーブルを
-- ロックするが、この規模なら一瞬で終わるので問題にならない。
create or replace function refresh_user_season_stats()
returns void language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view user_season_stats;
end $$;

revoke all on function refresh_user_season_stats() from public;
grant execute on function refresh_user_season_stats() to service_role;

-- ---------------------------------------------------------------------
-- 月初のポイント付与
-- 部分一意インデックスがあるので、何度実行しても二重付与にならない。
-- ---------------------------------------------------------------------

create or replace function grant_season_points(p_season_code text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_season seasons%rowtype;
  v_count  int;
begin
  select * into v_season from seasons where code = p_season_code;
  if not found then
    raise exception 'season % not found', p_season_code;
  end if;

  insert into point_ledger (user_id, season_code, entry_type, amount, memo)
  select p.id, v_season.code, 'grant', v_season.grant_amount, '月初付与'
  from profiles p
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function grant_season_points(text) from public;
grant execute on function grant_season_points(text) to service_role;

-- ---------------------------------------------------------------------
-- ランキング取得
-- 「自分 + 承認済みフレンド」だけを対象にする。
-- ---------------------------------------------------------------------

create or replace function friend_ranking(
  p_season_code text,      -- null なら通算
  p_metric      text       -- 'profit' | 'roi' | 'hit'
)
returns table (
  user_id      uuid,
  handle       text,
  display_name text,
  avatar_url   text,
  bet_count    int,
  hit_count    int,
  total_stake  bigint,
  total_payout bigint,
  profit       bigint,
  roi_pct      numeric,
  hit_pct      numeric,
  is_me        boolean
)
-- security definer にしているのは、集計ビューへの直接アクセスを
-- クライアントから遮断しているため。可視範囲は下の circle CTE が
-- 「自分 + 承認済みフレンド」に限定している。
-- 内部の列参照はすべてテーブル別名で修飾している。
-- RETURNS TABLE の列名（user_id, profit など）は関数本体でも名前として
-- 見えるため、修飾しないと "column reference is ambiguous" になる。
language sql stable security definer set search_path = public as $$
  with circle as (
    select auth.uid() as uid
    union
    select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
    from friendships f
    where f.status = 'accepted'
      and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
  ),
  stats as (
    select t.user_id, t.bet_count, t.hit_count, t.total_stake,
           t.total_payout, t.profit, t.roi_pct, t.hit_pct
    from user_season_totals t
    where p_season_code is not null and t.season_code = p_season_code
    union all
    select l.user_id, l.bet_count, l.hit_count, l.total_stake,
           l.total_payout, l.profit, l.roi_pct, l.hit_pct
    from user_lifetime_totals l
    where p_season_code is null
  )
  select
    c.uid,
    p.handle,
    p.display_name,
    p.avatar_url,
    coalesce(s.bet_count, 0),
    coalesce(s.hit_count, 0),
    coalesce(s.total_stake, 0::bigint),
    coalesce(s.total_payout, 0::bigint),
    coalesce(s.profit, 0::bigint),
    s.roi_pct,
    s.hit_pct,
    c.uid = auth.uid()
  from circle c
  join profiles p on p.id = c.uid
  left join stats s on s.user_id = c.uid
  order by
    case when p_metric = 'roi'  then s.roi_pct end desc nulls last,
    case when p_metric = 'hit'  then s.hit_pct end desc nulls last,
    case when p_metric = 'profit' then coalesce(s.profit, 0::bigint) end desc nulls last;
$$;

grant execute on function friend_ranking(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 個人成績（賭け式別）
--
-- 自分の成績か、承認済みフレンドの成績しか返さない。
-- 集計ビューを直接読ませない代わりの入口。
-- ---------------------------------------------------------------------

create or replace function user_stats(
  p_user_id     uuid,
  p_season_code text default null   -- null なら全シーズン
)
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
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- 他人の成績は、フレンドとして承認し合っている場合だけ見られる
  if p_user_id <> auth.uid() and not are_friends(auth.uid(), p_user_id) then
    raise exception 'フレンドではありません' using errcode = '42501';
  end if;

  return query
    select s.season_code, s.sport_code, s.bet_type_code,
           s.bet_count, s.hit_count, s.total_stake, s.total_payout, s.profit
    from user_season_stats s
    where s.user_id = p_user_id
      and (p_season_code is null or s.season_code = p_season_code);
end $$;

grant execute on function user_stats(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- フレンドのタイムライン
-- 締切後の投票と、確定した結果だけが流れる。
-- ---------------------------------------------------------------------

create or replace function friend_timeline(p_limit int default 50)
returns table (
  bet_id       uuid,
  user_id      uuid,
  handle       text,
  display_name text,
  event_title  text,
  venue_name   text,
  race_number  int,
  bet_type_code text,
  selection    text,
  stake        int,
  status       text,
  payout       bigint,
  occurred_at  timestamptz
)
language sql stable security invoker set search_path = public as $$
  select
    b.id, b.user_id, p.handle, p.display_name,
    e.title, e.venue_name, e.race_number,
    m.bet_type_code, b.selection, b.stake, b.status, b.payout,
    coalesce(b.settled_at, m.closes_at)
  from bets b
  join markets  m on m.id = b.market_id
  join events   e on e.id = m.event_id
  join profiles p on p.id = b.user_id
  where m.closes_at <= now()
  order by coalesce(b.settled_at, m.closes_at) desc
  limit p_limit;
$$;

grant execute on function friend_timeline(int) to authenticated;
