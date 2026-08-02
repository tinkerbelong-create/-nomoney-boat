-- =====================================================================
-- マスタデータ投入
-- =====================================================================

-- 競技。今はボートレースのみ。
insert into sports (code, name, adapter_key, sort_order) values
  ('boatrace', 'ボートレース', 'boatrace', 1)
on conflict (code) do nothing;

-- このサイトで扱う賭け式6種類。
-- 実際の舟券は拡連複（ワイド）を含む7種類だが、ワイドは扱わない方針。
-- 復活させたいときは次の1行を足すだけでよい（アプリ側の変更は不要）:
--   ('boatrace', 'wide', '拡連複', 'ワイド', 'combo_unordered', 2, 5)
insert into bet_types (sport_code, code, name, short_name, selection_kind, pick_count, sort_order) values
  ('boatrace', 'trifecta',  '3連単', '3連単', 'combo_ordered',   3, 1),
  ('boatrace', 'trio',      '3連複', '3連複', 'combo_unordered', 3, 2),
  ('boatrace', 'exacta',    '2連単', '2連単', 'combo_ordered',   2, 3),
  ('boatrace', 'quinella',  '2連複', '2連複', 'combo_unordered', 2, 4),
  ('boatrace', 'win',       '単勝',   '単勝',   'single',          1, 5),
  ('boatrace', 'place',     '複勝',   '複勝',   'single',          1, 6)
on conflict (sport_code, code) do nothing;

-- シーズン（JST基準）。運用では season-grant ジョブが先々の分を作る。
insert into seasons (code, starts_at, ends_at, grant_amount) values
  ('2026-08', '2026-08-01 00:00:00+09', '2026-09-01 00:00:00+09', 50000),
  ('2026-09', '2026-09-01 00:00:00+09', '2026-10-01 00:00:00+09', 50000),
  ('2026-10', '2026-10-01 00:00:00+09', '2026-11-01 00:00:00+09', 50000)
on conflict (code) do nothing;
