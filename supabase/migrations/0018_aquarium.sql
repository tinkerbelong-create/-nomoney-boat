-- =====================================================================
-- 水槽（アクアリウム）
--
-- 的中すると海の生き物が1体もらえる。ポイントは使わない。
-- 生き物は売れない・譲れない・ポイントに戻せない。
-- バッジ（称号）とまったく同じ「実績の記録」として扱う。
--
-- 設計の全文は docs/aquarium-design.md
--
-- 【設計の要点】
--   ・生き物の定義も排出率もグレード表も、コードではなくテーブルの行として持つ。
--     賭け式やバッジと同じ方針。調整が UPDATE 1行で済む。
--   ・抽選の乱数はDB側で引く。クライアントに引かせるとリロードで引き直せてしまう。
--   ・1レース1回しか引けない。creature_draws の一意制約で担保する。
--     精算バッチが再実行されても抽選はやり直されない。
--   ・生き物 → ポイント の逆流路は「作らない」ではなく「作れない」ようにする。
--     売却・譲渡にあたる関数を定義せず、RLS も select しか与えない。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 生き物のマスタ
-- ---------------------------------------------------------------------

create table if not exists creatures (
  code        text primary key,
  name        text not null,
  star        int  not null check (star between 1 and 10),
  /** 魚 / 甲殻 / 貝 / 頭足 / クラゲ / 棘皮 / 海藻 / サンゴ / 海獣 / その他 */
  category    text not null,
  /** 描画の型。fish, crab, jelly … 全25種類。docs/scripts/fish_shapes.py が決める */
  family      text not null,
  color_a     text not null,
  color_b     text not null,
  /** 水槽での動き。swim=中層を泳ぐ / float=漂う / crawl=底を這う / fix=底に固定 */
  move        text not null check (move in ('swim', 'float', 'crawl', 'fix')),

  -- ---- 出現条件。すべて null / false ならどこでも出る（ベース）----
  -- 条件は1体につき1つだけ。AND にはしない（候補が枯れて抽選が止まるため）
  /** '淡水' / '汽水' / '海水'。その水質の場でだけ出る */
  water       text check (water in ('淡水', '汽水', '海水')),
  /** '関東' / '東海' / '近畿' / '四国' / '中国' / '九州'。その地区でだけ出る */
  area        text,
  /** true なら夜（締切18:00以降）のレースでだけ出る */
  night       boolean not null default false,
  /** 場コード。24場の主。その場でだけ出る */
  venue_code  text,

  description text not null default '',
  sort_order  int  not null default 0
);

create index if not exists creatures_star_idx on creatures (star);

-- ---------------------------------------------------------------------
-- 2. 持っている生き物
-- ---------------------------------------------------------------------

create table if not exists user_creatures (
  user_id       uuid not null references profiles(id) on delete cascade,
  creature_code text not null references creatures(code) on delete cascade,
  /** 同じ生き物は何体でも増える。水槽なのだから当然 */
  count         int  not null default 1,
  first_at      timestamptz not null default now(),
  last_at       timestamptz not null default now(),
  /**
   * はじめて手に入れたときの記録。
   * { eventId, venue, raceNo, date, betType, selection, stake, payout, ratio }
   * 水槽で生き物をタップすると、この中身が出る。
   */
  meta          jsonb not null default '{}',
  primary key (user_id, creature_code)
);

create index if not exists user_creatures_user_idx on user_creatures (user_id, last_at desc);

-- ---------------------------------------------------------------------
-- 3. 抽選済みの記録
--
-- 抽選が絡むので、バッジのような「何度実行しても同じ結果」が成り立たない。
-- 精算バッチが再実行されるたびに引き直せてしまうと、
-- 「良い結果が出るまで再実行する」ができてしまう。
-- レース単位で1回きりにする。ここが最終防衛線。
-- ---------------------------------------------------------------------

create table if not exists creature_draws (
  user_id       uuid not null references profiles(id) on delete cascade,
  event_id      uuid not null references events(id) on delete cascade,
  creature_code text references creatures(code),
  star          int,
  drawn_at      timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- ---------------------------------------------------------------------
-- 4. 水槽。1つに30体まで
--
-- 定員があるから水槽を増やす意味が生まれる。全324体を飾るには11水槽いる。
-- 描画の負荷にも上限がつく（30体ならCSSアニメーションで軽い）。
-- ---------------------------------------------------------------------

create table if not exists tanks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  idx        int  not null default 1,
  name       text not null default 'すいそう',
  created_at timestamptz not null default now(),
  unique (user_id, idx)
);

create table if not exists tank_creatures (
  tank_id       uuid not null references tanks(id) on delete cascade,
  creature_code text not null references creatures(code) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (tank_id, creature_code)
);

create index if not exists tank_creatures_tank_idx on tank_creatures (tank_id);

/** 1水槽の定員。ここを変えれば全体に効く */
create or replace function tank_capacity() returns int
language sql immutable as $$ select 30 $$;

/** 定員オーバーをDB側で止める。画面のバグで31体目が入らないように */
create or replace function tank_capacity_check()
returns trigger language plpgsql as $$
begin
  if (select count(*) from tank_creatures where tank_id = new.tank_id) >= tank_capacity() then
    raise exception '水槽は % 体までです', tank_capacity();
  end if;
  return new;
end;
$$;

drop trigger if exists tank_creatures_cap on tank_creatures;
create trigger tank_creatures_cap
  before insert on tank_creatures
  for each row execute function tank_capacity_check();

-- ---------------------------------------------------------------------
-- 5. 排出率
--
-- グレード（1〜10）ごとに ★1〜★10 の出る確率（%）を持つ。
-- 生成と検証は docs/scripts/fish_rates.py。10項目の検査を通してある。
--   ・各行の合計がちょうど100
--   ・確率的単調性（グレードが上がれば、どの★閾値でも確率が下がらない）
--   ・単峰性、穴なし
--   ・G1〜G5 は★10がゼロ（100倍未満では絶対に出ない）
-- ---------------------------------------------------------------------

create table if not exists creature_rates (
  grade   int primary key check (grade between 1 and 10),
  /** ★1〜★10 の重み（%）。合計100 */
  weights int[] not null check (array_length(weights, 1) = 10)
);

insert into creature_rates (grade, weights) values
  (1,  '{58,38,4,0,0,0,0,0,0,0}'),
  (2,  '{19,47,29,5,0,0,0,0,0,0}'),
  (3,  '{4,23,42,26,5,0,0,0,0,0}'),
  (4,  '{1,5,24,40,24,5,1,0,0,0}'),
  (5,  '{0,1,5,24,40,24,5,1,0,0}'),
  (6,  '{0,0,0,5,21,37,23,6,5,3}'),
  (7,  '{0,0,0,0,4,21,38,25,6,6}'),
  (8,  '{0,0,0,0,0,2,18,39,26,15}'),
  (9,  '{0,0,0,0,0,0,1,15,44,40}'),
  (10, '{0,0,0,0,0,0,0,0,0,100}')
on conflict (grade) do update set weights = excluded.weights;

-- 合計が100でない行があったら、その場で気づけるようにしておく
do $$
declare r record;
begin
  for r in select grade, (select sum(x) from unnest(weights) x) as s from creature_rates loop
    if r.s <> 100 then raise exception '排出率の合計が100ではありません: G% = %', r.grade, r.s; end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. グレードの決め方
--
--   グレード = 表[倍率帯][掛け金帯] + 等級ボーナス
--   ただし倍率帯ごとの天井を超えない
--
-- 天井があるので、等級をいくら上げても★10のルールは破れない。
-- 100倍未満は G5 止まり（★10は0%）、100〜300倍は G6 止まり（★10は3%）。
-- G10（★10確定）に届くのは「1000倍以上 × 1000pt」のマスだけで、
-- これも等級では買えない。
-- ---------------------------------------------------------------------

create table if not exists creature_grade_grid (
  /** 倍率帯 1..7（1=10倍未満 … 7=1000倍以上） */
  odds_rank  int not null,
  /** 掛け金帯 1..5（1=100pt / 2=200〜400 / 3=500〜700 / 4=800〜900 / 5=1000pt〜） */
  stake_rank int not null,
  grade      int not null check (grade between 1 and 10),
  primary key (odds_rank, stake_rank)
);

insert into creature_grade_grid (odds_rank, stake_rank, grade) values
  (7,1,8),(7,2,8),(7,3,9),(7,4,9),(7,5,10),
  (6,1,7),(6,2,7),(6,3,8),(6,4,8),(6,5,9),
  (5,1,6),(5,2,6),(5,3,7),(5,4,7),(5,5,8),
  (4,1,5),(4,2,5),(4,3,6),(4,4,6),(4,5,6),
  (3,1,3),(3,2,4),(3,3,4),(3,4,5),(3,5,5),
  (2,1,2),(2,2,2),(2,3,3),(2,4,3),(2,5,4),
  (1,1,1),(1,2,1),(1,3,1),(1,4,2),(1,5,2)
on conflict (odds_rank, stake_rank) do update set grade = excluded.grade;

create table if not exists creature_grade_cap (
  odds_rank int primary key,
  cap       int not null
);

insert into creature_grade_cap (odds_rank, cap) values
  (1,5),(2,5),(3,5),   -- 100倍未満。ここが★10ゼロの担保
  (4,6),               -- 100〜300倍。★10は3%どまり
  (5,8),(6,9),(7,9)    -- 1000倍×1000pt のマスだけ例外で10
on conflict (odds_rank) do update set cap = excluded.cap;

create table if not exists creature_grade_bonus (
  grade_code text primary key,
  bonus      int not null
);

insert into creature_grade_bonus (grade_code, bonus) values
  ('一般', 0), ('G3', 1), ('G2', 2), ('PG1', 3), ('G1', 3), ('SG', 4)
on conflict (grade_code) do update set bonus = excluded.bonus;

-- ---------------------------------------------------------------------
-- 7. 場の属性（水質・地区）
--
-- 地区は packages/core/src/venues.ts と同じ。水質は公式の分類。
-- 開催時間帯の表は持たない。年度で変わるので、夜かどうかは締切時刻から出す。
-- ---------------------------------------------------------------------

create table if not exists venue_traits (
  venue_code text primary key,
  venue_name text not null,
  area       text not null,
  water      text not null check (water in ('淡水', '汽水', '海水'))
);

insert into venue_traits (venue_code, venue_name, area, water) values
  ('01','桐生','関東','淡水'), ('02','戸田','関東','淡水'), ('03','江戸川','関東','汽水'),
  ('04','平和島','関東','海水'), ('05','多摩川','関東','淡水'), ('06','浜名湖','東海','汽水'),
  ('07','蒲郡','東海','汽水'), ('08','常滑','東海','海水'), ('09','津','東海','汽水'),
  ('10','三国','近畿','淡水'), ('11','びわこ','近畿','淡水'), ('12','住之江','近畿','淡水'),
  ('13','尼崎','近畿','淡水'), ('14','鳴門','四国','海水'), ('15','丸亀','四国','海水'),
  ('16','児島','中国','海水'), ('17','宮島','中国','海水'), ('18','徳山','中国','海水'),
  ('19','下関','中国','海水'), ('20','若松','九州','海水'), ('21','芦屋','九州','淡水'),
  ('22','福岡','九州','汽水'), ('23','唐津','九州','淡水'), ('24','大村','九州','海水')
on conflict (venue_code) do update set
  venue_name = excluded.venue_name, area = excluded.area, water = excluded.water;

/** 夜のレースか。締切18:00以降。デイ開催は17時頃に終わるのでここには入らない */
create or replace function is_night_race(p_deadline timestamptz)
returns boolean language sql immutable as $$
  select (p_deadline at time zone 'Asia/Tokyo')::time >= time '18:00'
$$;

-- ---------------------------------------------------------------------
-- 8. RLS
--
-- insert / update / delete は誰にも与えない。
-- 付与は security definer 関数からだけ。
-- 「売らない」ではなく「売る手段が存在しない」状態にしておく。
-- ---------------------------------------------------------------------

alter table creatures         enable row level security;
alter table user_creatures    enable row level security;
alter table creature_draws    enable row level security;
alter table tanks             enable row level security;
alter table tank_creatures    enable row level security;
alter table creature_rates    enable row level security;
alter table venue_traits      enable row level security;

drop policy if exists creatures_read on creatures;
create policy creatures_read on creatures for select using (auth.uid() is not null);

drop policy if exists creature_rates_read on creature_rates;
create policy creature_rates_read on creature_rates for select using (auth.uid() is not null);

drop policy if exists venue_traits_read on venue_traits;
create policy venue_traits_read on venue_traits for select using (auth.uid() is not null);

/** 自分と、承認済みフレンドの水槽は見える。user_badges と同じ条件 */
drop policy if exists user_creatures_read on user_creatures;
create policy user_creatures_read on user_creatures for select using (
  user_id = auth.uid()
  or exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.requester_id = auth.uid() and f.addressee_id = user_creatures.user_id)
        or (f.addressee_id = auth.uid() and f.requester_id = user_creatures.user_id))
  )
);

drop policy if exists creature_draws_read on creature_draws;
create policy creature_draws_read on creature_draws
  for select using (user_id = auth.uid());

drop policy if exists tanks_read on tanks;
create policy tanks_read on tanks for select using (
  user_id = auth.uid()
  or exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.requester_id = auth.uid() and f.addressee_id = tanks.user_id)
        or (f.addressee_id = auth.uid() and f.requester_id = tanks.user_id))
  )
);

drop policy if exists tank_creatures_read on tank_creatures;
create policy tank_creatures_read on tank_creatures for select using (
  exists (select 1 from tanks t where t.id = tank_creatures.tank_id
          and (t.user_id = auth.uid()
               or exists (select 1 from friendships f
                          where f.status = 'accepted'
                            and ((f.requester_id = auth.uid() and f.addressee_id = t.user_id)
                              or (f.addressee_id = auth.uid() and f.requester_id = t.user_id)))))
);
