-- =====================================================================
-- 水槽が正しく入ったかの確認。これ1本だけ実行する。
--
-- 【注意】Supabase の SQL Editor は、複数の文をまとめて実行すると
-- 最後の1文の結果しか表示しない。だから確認は1文にまとめてある。
-- =====================================================================

select
  (select count(*) from creatures)                                as 生き物,
  (select count(*) from creatures where venue_code is not null)   as 場の主,
  (select count(*) from creature_rates)                           as 排出率,
  (select count(*) from creature_grade_grid)                      as グレード表,
  (select count(*) from creature_grade_cap)                       as 天井,
  (select count(*) from creature_grade_bonus)                     as 等級ボーナス,
  (select count(*) from venue_traits)                             as 場の属性,
  (select count(*) from user_creatures)                           as 取得済み,
  (select count(*) from tanks)                                    as 水槽;

-- 期待する値
--   生き物 324 / 場の主 24 / 排出率 10 / グレード表 35 / 天井 7
--   等級ボーナス 6 / 場の属性 24
--   取得済みと水槽は、さかのぼり（backfill-creatures）を実行するまで 0
--
-- 生き物が 0 なら seed_creatures.sql がまだ。
-- 排出率が 0 なら 0018_aquarium.sql がまだ。
-- テーブルが無いというエラーが出たら、そのマイグレーションがまだ。
