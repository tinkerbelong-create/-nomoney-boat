-- =====================================================================
-- 精算がずっと失敗していた原因の修正
--
-- point_ledger の二重計上防止インデックスを「部分インデックス」
-- （where ref_id is not null 付き）で作っていた。
--
-- PostgreSQL は ON CONFLICT (列...) の書き方では部分インデックスを
-- 使えない。そのため精算のたびに
--   「there is no unique or exclusion constraint matching the
--     ON CONFLICT specification」
-- で失敗し、投票がずっと「結果待ち」のままになっていた。
--
-- where 句を外して普通の一意インデックスにする。
-- ref_id が NULL の行（月初付与など）は、PostgreSQL では NULL 同士を
-- 別物として扱うため、これまでどおり何行でも入る。
-- =====================================================================

drop index if exists point_ledger_ref_uniq;

create unique index point_ledger_ref_uniq
  on point_ledger (ref_type, ref_id, entry_type);
