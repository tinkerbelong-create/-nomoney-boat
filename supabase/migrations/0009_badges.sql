-- =====================================================================
-- 称号（バッジ）
--
-- 称号はコードに埋め込まず、テーブルの行として持つ。
-- 賭け式を行にしたのと同じ考え方で、あとから増やすのがタダになる。
--
-- 判定は精算のたびに award_badges(user_id) を1回呼ぶだけ。
-- 何度呼んでも同じ結果になる（すでに持っている称号は無視される）。
-- =====================================================================

create table if not exists badges (
  code        text primary key,
  name        text not null,
  description text not null default '',
  category    text not null,
  rarity      text not null default 'bronze'
                check (rarity in ('bronze', 'silver', 'gold', 'crown')),
  sort_order  int  not null default 0,
  /** 月間タイトルなど、期間限定のもの。常設なら null */
  season_code text
);

create table if not exists user_badges (
  user_id    uuid        not null references profiles(id) on delete cascade,
  badge_code text        not null references badges(code) on delete cascade,
  earned_at  timestamptz not null default now(),
  meta       jsonb       not null default '{}',
  primary key (user_id, badge_code)
);

create index if not exists user_badges_user_idx on user_badges (user_id, earned_at desc);

alter table badges enable row level security;
alter table user_badges enable row level security;

drop policy if exists badges_read on badges;
create policy badges_read on badges for select using (auth.uid() is not null);

-- 自分と、承認済みフレンドの称号は見える
drop policy if exists user_badges_read on user_badges;
create policy user_badges_read on user_badges for select using (
  user_id = auth.uid()
  or exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.requester_id = auth.uid() and f.addressee_id = user_badges.user_id)
        or (f.addressee_id = auth.uid() and f.requester_id = user_badges.user_id))
  )
);

-- =====================================================================
-- 称号の定義
-- =====================================================================

insert into badges (code, name, description, category, rarity, sort_order) values
  -- はじめの一歩
  ('first_bet',     '初舟券',       'はじめて投票した',                 'start', 'bronze', 1),
  ('first_hit',     '初的中',       'はじめて的中した',                 'start', 'bronze', 2),
  ('first_man',     '初万舟',       'はじめて100倍以上を的中',          'start', 'silver', 3),
  ('first_tri',     'はじめての3連単', '3連単ではじめて的中',            'start', 'bronze', 4),
  ('first_trio',    'はじめての3連複', '3連複ではじめて的中',            'start', 'bronze', 5),
  ('first_friend',  '対戦の始まり', 'フレンドが1人できた',              'start', 'bronze', 6),
  ('first_fav',     '相棒',         'お気に入り選手を登録した',          'start', 'bronze', 7),

  -- 的中の数
  ('hit_5',    '的中5',    '通算5レース的中',    'count', 'bronze', 10),
  ('hit_10',   '的中10',   '通算10レース的中',   'count', 'bronze', 11),
  ('hit_25',   '的中25',   '通算25レース的中',   'count', 'bronze', 12),
  ('hit_50',   '的中50',   '通算50レース的中',   'count', 'silver', 13),
  ('hit_100',  '的中100',  '通算100レース的中',  'count', 'silver', 14),
  ('hit_200',  '的中200',  '通算200レース的中',  'count', 'gold',   15),
  ('hit_500',  '的中500',  '通算500レース的中',  'count', 'gold',   16),
  ('play_10',   '参加10',   '通算10レース投票',   'count', 'bronze', 20),
  ('play_50',   '参加50',   '通算50レース投票',   'count', 'bronze', 21),
  ('play_100',  '参加100',  '通算100レース投票',  'count', 'silver', 22),
  ('play_500',  '参加500',  '通算500レース投票',  'count', 'gold',   23),
  ('play_1000', '参加1000', '通算1000レース投票', 'count', 'gold',   24),

  -- 連続的中
  ('streak_2',  '2連続的中',  '2レース連続で的中',  'streak', 'bronze', 30),
  ('streak_3',  '3連続的中',  '3レース連続で的中',  'streak', 'silver', 31),
  ('streak_5',  '5連続的中',  '5レース連続で的中',  'streak', 'gold',   32),
  ('streak_7',  '7連続的中',  '7レース連続で的中',  'streak', 'gold',   33),
  ('streak_10', '10連続的中', '10レース連続で的中', 'streak', 'crown',  34),

  -- 負け・不名誉
  ('lose_3',   '3連敗',   '3レース連続で外す',   'lose', 'bronze', 40),
  ('lose_5',   '5連敗',   '5レース連続で外す',   'lose', 'bronze', 41),
  ('lose_10',  '10連敗',  '10レース連続で外す',  'lose', 'bronze', 42),
  ('lose_20',  '20連敗',  '20レース連続で外す',  'lose', 'silver', 43),
  ('lose_30',  '30連敗',  '30レース連続で外す',  'lose', 'silver', 44),
  ('lose_50',  '50連敗',  '50レース連続で外す',  'lose', 'gold',   45),
  ('lose_100', '100連敗', '100レース連続で外す', 'lose', 'crown',  46),
  ('big_loss',   '高い勉強代', '1レースで10,000pt以上使って外す', 'lose', 'bronze', 47),
  ('huge_loss',  '授業料は払った', '1レースで50,000pt以上使って外す', 'lose', 'silver', 48),
  ('broke',      '溶けた',     '残高が5,000pt未満になった',       'lose', 'bronze', 49),
  ('very_broke', 'ほぼ無一文', '残高が1,000pt未満になった',       'lose', 'silver', 50),

  -- 高配当
  ('odds_10',   '二桁配当',   '10倍以上を的中',   'payout', 'bronze', 60),
  ('odds_100',  '万舟券',     '100倍以上を的中',  'payout', 'silver', 61),
  ('odds_300',  '超万舟',     '300倍以上を的中',  'payout', 'gold',   62),
  ('odds_500',  '大万舟',     '500倍以上を的中',  'payout', 'gold',   63),
  ('odds_1000', '伝説の一撃', '1000倍以上を的中', 'payout', 'crown',  64),
  ('pay_100k',  '10万pt回収', '1レースで100,000pt以上の払戻', 'payout', 'gold',  65),
  ('pay_500k',  '50万pt回収', '1レースで500,000pt以上の払戻', 'payout', 'crown', 66),
  ('pop_20',    '人気を嫌う', '20番人気以下を的中', 'payout', 'silver', 67),
  ('pop_50',    '大穴ハンター', '50番人気以下を的中', 'payout', 'gold',  68),
  ('pop_120',   '最低人気',   '120番人気を的中',   'payout', 'crown',  69),

  -- 賭け式
  ('bt_trifecta_10',  '3連単 初段', '3連単で10レース的中',  'bettype', 'bronze', 80),
  ('bt_trifecta_50',  '3連単 五段', '3連単で50レース的中',  'bettype', 'silver', 81),
  ('bt_trifecta_100', '3連単 名人', '3連単で100レース的中', 'bettype', 'gold',   82),
  ('bt_trio_10',      '3連複 初段', '3連複で10レース的中',  'bettype', 'bronze', 83),
  ('bt_trio_50',      '3連複 五段', '3連複で50レース的中',  'bettype', 'silver', 84),
  ('bt_trio_100',     '3連複 名人', '3連複で100レース的中', 'bettype', 'gold',   85),
  ('bt_exacta_10',    '2連単 初段', '2連単で10レース的中',  'bettype', 'bronze', 86),
  ('bt_exacta_50',    '2連単 五段', '2連単で50レース的中',  'bettype', 'silver', 87),
  ('bt_exacta_100',   '2連単 名人', '2連単で100レース的中', 'bettype', 'gold',   88),
  ('bt_quinella_10',  '2連複 初段', '2連複で10レース的中',  'bettype', 'bronze', 89),
  ('bt_quinella_50',  '2連複 五段', '2連複で50レース的中',  'bettype', 'silver', 90),
  ('bt_quinella_100', '2連複 名人', '2連複で100レース的中', 'bettype', 'gold',   91),
  ('bt_win_10',       '単勝 初段',  '単勝で10レース的中',   'bettype', 'bronze', 92),
  ('bt_win_50',       '単勝 五段',  '単勝で50レース的中',   'bettype', 'silver', 93),
  ('bt_place_10',     '複勝 初段',  '複勝で10レース的中',   'bettype', 'bronze', 94),
  ('bt_place_50',     '複勝 五段',  '複勝で50レース的中',   'bettype', 'silver', 95),
  ('bt_all',          '六刀流',     '6種類すべてで的中経験がある', 'bettype', 'silver', 96),

  -- 買い方
  ('single_hit',   '一点勝負',   '1点だけ買って的中',        'style', 'bronze', 100),
  ('single_10',    '一点必中',   '1点買いで10レース的中',    'style', 'gold',   101),
  ('single_man',   '一点で万舟', '1点買いで100倍以上を的中', 'style', 'crown',  102),
  ('bulk_50',      '大量購入',   '1レースで50点以上買う',    'style', 'bronze', 103),
  ('bulk_120',     '全通り',     '1レースで120点買う',       'style', 'silver', 104),
  ('tickets_1000', '塵も積もれば', '通算1,000点の舟券を買う', 'style', 'silver', 105),

  -- 艇番のクセ
  ('lane1_30', '1号艇信者', '1号艇の頭で30レース的中', 'lane', 'bronze', 110),
  ('lane2_20', '2号艇の男', '2号艇の頭で20レース的中', 'lane', 'silver', 111),
  ('lane3_20', '3号艇の男', '3号艇の頭で20レース的中', 'lane', 'silver', 112),
  ('lane4_20', '4号艇の男', '4号艇の頭で20レース的中', 'lane', 'silver', 113),
  ('lane5_15', '5号艇の男', '5号艇の頭で15レース的中', 'lane', 'gold',   114),
  ('lane6_10', '6号艇の男', '6号艇の頭で10レース的中', 'lane', 'gold',   115),
  ('lane_all', '全艇制覇',  '1〜6号艇すべての頭で的中', 'lane', 'silver', 116),
  ('combo_123', '順番どおり', '1-2-3 を的中',           'lane', 'bronze', 117),
  ('combo_654', '逆さま',     '6-5-4 を的中',           'lane', 'gold',   118),

  -- 収支
  ('profit_day',   '黒字の日',   '1日の収支がプラス',        'money', 'bronze', 130),
  ('profit_100k',  '10万勝ち',   '月間収支が+100,000pt以上', 'money', 'gold',   131),
  ('profit_500k',  '50万勝ち',   '月間収支が+500,000pt以上', 'money', 'crown',  132),
  ('bal_100k',     '倍にした',   '残高が100,000pt以上に到達', 'money', 'gold',  133),
  ('bal_150k',     '三倍にした', '残高が150,000pt以上に到達', 'money', 'crown', 134),
  ('comeback',     '底から',     '5,000pt未満から50,000pt以上に戻す', 'money', 'gold', 135),
  ('total_1m',     '通算100万pt', '通算払戻が1,000,000pt到達',  'money', 'gold',  136),
  ('total_10m',    '通算1000万pt', '通算払戻が10,000,000pt到達', 'money', 'crown', 137),

  -- 習慣・時間帯
  ('morning',  '朝からやる人',   '10時台締切のレースで的中', 'habit', 'bronze', 140),
  ('noon',     '昼休みの男',     '12時台締切のレースで的中', 'habit', 'bronze', 141),
  ('night',    '夜のボートレース', '20時以降締切のレースで的中', 'habit', 'bronze', 142),
  ('r1',       '1R党',  '1Rで10レース的中',  'habit', 'silver', 143),
  ('r12',      '12R党', '12Rで10レース的中', 'habit', 'silver', 144),
  ('days_3',   '皆勤3日',   '3日連続で投票',   'habit', 'bronze', 145),
  ('days_7',   '皆勤7日',   '7日連続で投票',   'habit', 'bronze', 146),
  ('days_30',  '皆勤30日',  '30日連続で投票',  'habit', 'silver', 147),
  ('days_100', '皆勤100日', '100日連続で投票', 'habit', 'gold',   148),
  ('days_365', '皆勤365日', '365日連続で投票', 'habit', 'crown',  149),

  -- お題レース
  ('feat_first',  'お題デビュー',   'お題レースにはじめて参加',   'feature', 'bronze', 160),
  ('feat_hit',    'お題的中',       'お題レースで的中',           'feature', 'bronze', 161),
  ('feat_hit_20', 'お題マスター',   'お題レースで20回的中',       'feature', 'silver', 162),
  ('feat_hit_50', 'お題の鬼',       'お題レースで50回的中',       'feature', 'gold',   163),
  ('feat_man',    'お題で万舟',     'お題レースで100倍以上を的中', 'feature', 'gold',  164),
  ('feat_days_7',  'お題皆勤7日',   '7日連続でお題レースに参加',   'feature', 'bronze', 165),
  ('feat_days_30', 'お題皆勤30日',  '30日連続でお題レースに参加',  'feature', 'silver', 166),
  ('feat_days_100','お題皆勤100日', '100日連続でお題レースに参加', 'feature', 'gold',   167),

  -- 対戦
  ('friends_3',  '3人集まった',  'フレンドが3人',   'social', 'bronze', 180),
  ('friends_5',  '5人集まった',  'フレンドが5人',   'social', 'bronze', 181),
  ('friends_10', '10人集まった', 'フレンドが10人',  'social', 'silver', 182),

  -- 選手
  ('fav_10',      '推しは10人まで', 'お気に入りを10人登録',        'racer', 'bronze', 190),
  ('fav_hit',     '推しで的中',     'お気に入り選手の頭で的中',     'racer', 'bronze', 191),
  ('fav_hit_10',  '推しで10勝',     'お気に入り選手の頭で10レース的中', 'racer', 'silver', 192),
  ('fav_man',     '推しで万舟',     'お気に入り選手の頭で100倍以上を的中', 'racer', 'gold', 193),

  -- コレクション
  ('collect_10',  'コレクター',   '称号を10個集める',  'meta', 'bronze', 200),
  ('collect_50',  '大コレクター', '称号を50個集める',  'meta', 'silver', 201),
  ('collect_100', '殿堂入り',     '称号を100個集める', 'meta', 'crown',  202)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  rarity = excluded.rarity,
  sort_order = excluded.sort_order;

-- 場めぐり（24場）
insert into badges (code, name, description, category, rarity, sort_order)
select
  'venue_' || v.code,
  v.name || 'の主',
  v.name || 'で3レース的中',
  'venue',
  'bronze',
  120
from (values
  ('01','桐生'),('02','戸田'),('03','江戸川'),('04','平和島'),('05','多摩川'),('06','浜名湖'),
  ('07','蒲郡'),('08','常滑'),('09','津'),('10','三国'),('11','びわこ'),('12','住之江'),
  ('13','尼崎'),('14','鳴門'),('15','丸亀'),('16','児島'),('17','宮島'),('18','徳山'),
  ('19','下関'),('20','若松'),('21','芦屋'),('22','福岡'),('23','唐津'),('24','大村')
) as v(code, name)
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into badges (code, name, description, category, rarity, sort_order) values
  ('venue_all', '全国制覇', '24場すべてで的中', 'venue', 'crown', 129)
on conflict (code) do nothing;
