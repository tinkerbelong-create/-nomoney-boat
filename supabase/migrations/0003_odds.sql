-- =====================================================================
-- オッズのキャッシュ
--
-- オッズは「誰かがそのレースを見たときだけ」取りに行き、ここに貯める。
-- 全レースを定期取得すると公式サイトへのアクセスが桁違いに増えるため、
-- 実際に見られたものだけを、短い有効期限つきでキャッシュする方式にしている。
-- =====================================================================

create table market_odds (
  event_id          uuid not null references events(id) on delete cascade,
  bet_type_code     text not null,
  -- { "1-2-5": 23.8, "1-2-3": 11.7, ... } 形式。買い目は正規化済み。
  odds              jsonb not null default '{}',
  -- 公式サイトが表示している「オッズ更新時間」
  source_updated_at text,
  fetched_at        timestamptz not null default now(),
  primary key (event_id, bet_type_code)
);

create index market_odds_fetched_idx on market_odds (fetched_at);

alter table market_odds enable row level security;

create policy market_odds_select on market_odds
  for select to authenticated using (true);

-- 書き込みはこの関数経由のみ。
-- Web の API ルートから呼ぶので service role キーを持ち出さずに済む。
create or replace function upsert_market_odds(
  p_event_id          uuid,
  p_bet_type_code     text,
  p_odds              jsonb,
  p_source_updated_at text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into market_odds (event_id, bet_type_code, odds, source_updated_at, fetched_at)
  values (p_event_id, p_bet_type_code, p_odds, p_source_updated_at, now())
  on conflict (event_id, bet_type_code) do update
    set odds              = excluded.odds,
        source_updated_at = excluded.source_updated_at,
        fetched_at        = now();
end $$;

revoke all on function upsert_market_odds(uuid, text, jsonb, text) from public;
grant execute on function upsert_market_odds(uuid, text, jsonb, text) to authenticated;
