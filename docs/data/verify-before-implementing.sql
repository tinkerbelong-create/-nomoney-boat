-- =====================================================================
-- 実装前に必ず流して確認するSQL
-- 設計が実データと噛み合っているかを見る。Supabase の SQL Editor で実行。
-- =====================================================================

-- ① グレードは本当に取れているか
--    detectGradeFromTitle は開催タイトルに文字が出ているときしか拾えない。
--    grade が null ばかりなら、等級限定の魚は永久に出ない。
select coalesce(grade, '（null）') as grade, count(*) as races,
       round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from events where sport_code = 'boatrace'
group by 1 order by 2 desc;

-- ② SG は実際に何レースあるか
--    ここが0なら、SG限定の5種は誰も手に入れられない。
select date_trunc('month', deadline_at) as month, grade, count(*)
from events where sport_code = 'boatrace' and grade is not null
group by 1, 2 order by 1 desc, 2;

-- ③ 場ごとの締切時刻の分布 ← いちばん大事
--    「夜のレースがない場」がどこかを実データで確定させる。
--    夜(16:30〜)が0の場では、夜限定の12種は出ない。
select venue_name,
  count(*) filter (where (deadline_at at time zone 'Asia/Tokyo')::time <  '11:00') as 朝,
  count(*) filter (where (deadline_at at time zone 'Asia/Tokyo')::time >= '11:00'
                     and (deadline_at at time zone 'Asia/Tokyo')::time <  '16:30') as 昼,
  count(*) filter (where (deadline_at at time zone 'Asia/Tokyo')::time >= '16:30') as 夜,
  min((deadline_at at time zone 'Asia/Tokyo')::time) as 最早,
  max((deadline_at at time zone 'Asia/Tokyo')::time) as 最遅
from events where sport_code = 'boatrace'
group by venue_name order by 夜 desc;

-- ④ 場 × 等級 の実在する組み合わせ
--    机上では24場×5等級=120通りだが、実際には存在しない組み合わせがある。
select venue_name, coalesce(grade, '一般') as grade, count(*)
from events where sport_code = 'boatrace'
group by 1, 2 order by 1, 2;

-- ⑤ 払戻倍率の分布 ← 排出率グリッドが現実的かの確認
--    1000倍以上が年に何回あるのか。★10がどれくらい遠いのかが分かる。
select case
  when payout_ratio >= 1000 then 'e. 1000倍以上'
  when payout_ratio >=  500 then 'd. 500〜1000'
  when payout_ratio >=  300 then 'c. 300〜500'
  when payout_ratio >=  100 then 'b. 100〜300'
  when payout_ratio >=   30 then 'a. 30〜100'
  else '0. 30倍未満' end as band,
  count(*),
  round(100.0 * count(*) / sum(count(*)) over (), 3) as pct
from market_results group by 1 order by 1 desc;

-- =====================================================================
-- 【追加】水槽を入れる前・入れた後の確認
-- =====================================================================

-- ⑥ 進行中の大会が残っていないか ← 大会を撤去する前に必ず見る
--    running / open が残っていると、その人の大会ポイントが宙に浮く。
--    残っていたら、画面を消す前に `npm run ingest -- tournaments` で
--    終わらせて、持ちポイントに戻してから撤去する。
select status, count(*) from tournaments group by status;

-- ⑦ 大会ポイントで買った未精算の舟券が残っていないか
select count(*) as 未精算の大会舟券
from bets where tournament_id is not null and status = 'placed';

-- ---- ここから下は 0018 / 0019 / seed_creatures.sql を流したあとに ----

-- ⑧ 生き物が324体入ったか
select count(*) as 生き物, count(*) filter (where venue_code is not null) as 場の主
from creatures;

-- ⑨ 出現条件の内訳（ベース203 / 水質62 / 地区23 / 夜12 / 主24 になるはず）
select
  case when venue_code is not null then '主'
       when water is not null then '水質:' || water
       when area  is not null then '地区:' || area
       when night then '夜'
       else 'ベース' end as 条件,
  count(*)
from creatures group by 1 order by 2 desc;

-- ⑩ 排出率が10行そろっていて、各行の合計が100か
select grade, (select sum(x) from unnest(weights) x) as 合計 from creature_rates order by grade;

-- ⑪ さかのぼりのあと、誰が何体持っているか
select p.display_name, count(*) as 種類, sum(uc.count) as 体数
from user_creatures uc join profiles p on p.id = uc.user_id
group by p.display_name order by 3 desc;

-- ⑫ 水槽に何体入っているか（30が上限）
select p.display_name, t.name, count(tc.creature_code) as 体数
from tanks t
join profiles p on p.id = t.user_id
left join tank_creatures tc on tc.tank_id = t.id
group by 1, 2 order by 3 desc;
