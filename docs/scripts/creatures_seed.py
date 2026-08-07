"""
creatures テーブルの seed SQL を作る。

    python3 docs/scripts/creatures_seed.py

fish_species.py（300種）／ venue_lords.py（24場の主）／
fish_conditions.py（出現条件）／ fish_shapes.py（形の型と色）を全部読んで、
supabase/seed_creatures.sql を1本吐く。

このファイルを手で編集しないこと。名前や色を変えるときは元のスクリプトを直す。
"""
import os, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')

def load(name):
    ns = {}
    src = open(os.path.join(HERE, name), encoding='utf-8').read()
    exec(src.split('# ===================== 検証')[0], ns)
    return ns

sp = load('fish_species.py')
lo = load('venue_lords.py')
co = load('fish_conditions.py')
shapes = json.load(open(os.path.join(HERE, '..', 'data', 'creatures.json'), encoding='utf-8'))
SHAPE = {o['n']: o for o in shapes}
WHERE = {n: c for c, names in co['COND'].items() for n in names}
LORD_VENUE = {l[2]: (l[0], l[6]) for l in lo['LORDS']}   # 名前 -> (場コード, 説明)

def q(s): return "'" + str(s).replace("'", "''") + "'"

rows, err, i = [], [], 0
for s in range(1, 11):
    names = [n for n, _ in sp['SPECIES'][s]]
    for n in names:
        i += 1
        sh = SHAPE.get(n)
        if not sh: err.append(f'{n}: creatures.json にない'); continue
        w = WHERE.get(n, '')
        water = w[2:] if w.startswith('水:') else None
        area  = w[2:] if w.startswith('地:') else None
        night = (w == '時:夜')
        rows.append((f'c{i:03d}', n, s, sh['c'], sh['f'], sh['a'], sh['b'], sh['m'],
                     water, area, night, None, '', i))

for code, vn, n, kj, cat, moto, desc in lo['LORDS']:
    i += 1
    sh = SHAPE.get(n)
    if not sh: err.append(f'{n}: creatures.json にない'); continue
    rows.append((f'lord_{code}', n, 10, sh['c'], sh['f'], sh['a'], sh['b'], sh['m'],
                 None, None, False, code, desc, 900 + int(code)))

if len(rows) != 324: err.append(f'{len(rows)}行（324のはず）')
if len({r[0] for r in rows}) != len(rows): err.append('code が重複')
if len({r[1] for r in rows}) != len(rows): err.append('name が重複')
for r in rows:
    conds = sum(1 for x in (r[8], r[9], r[11]) if x) + (1 if r[10] else 0)
    if conds > 1: err.append(f'{r[1]}: 条件が2つ以上ついている')

print('検証:', '全項目パス' if not err else f'{len(err)}件')
for e in err[:10]: print('  NG', e)
if err: sys.exit(1)

vals = []
for c, n, s, cat, fam, a, b, mv, water, area, night, venue, desc, so in rows:
    vals.append('  (' + ', '.join([
        q(c), q(n), str(s), q(cat), q(fam), q('#'+a), q('#'+b), q(mv),
        q(water) if water else 'null',
        q(area) if area else 'null',
        'true' if night else 'false',
        q(venue) if venue else 'null',
        q(desc), str(so)]) + ')')

sql = ("-- 自動生成: python3 docs/scripts/creatures_seed.py\n"
       "-- 手で編集しないこと。名前・色・条件を変えるときは docs/scripts/ の元スクリプトを直す。\n"
       "--\n"
       "-- 300種 ＋ 24場の主 = 324体。\n"
       "-- 出現条件は1体につき1つまで（水質 / 地区 / 夜 / 場の主）。\n"
       "-- 条件が全部 null のものはどこでも出る（ベース203体）。\n\n"
       "insert into creatures\n"
       "  (code, name, star, category, family, color_a, color_b, move,\n"
       "   water, area, night, venue_code, description, sort_order)\n"
       "values\n" + ',\n'.join(vals) + "\n"
       "on conflict (code) do update set\n"
       "  name = excluded.name, star = excluded.star, category = excluded.category,\n"
       "  family = excluded.family, color_a = excluded.color_a, color_b = excluded.color_b,\n"
       "  move = excluded.move, water = excluded.water, area = excluded.area,\n"
       "  night = excluded.night, venue_code = excluded.venue_code,\n"
       "  description = excluded.description, sort_order = excluded.sort_order;\n")

out = os.path.join(ROOT, 'supabase', 'seed_creatures.sql')
open(out, 'w', encoding='utf-8').write(sql)
print(f'\n{len(rows)}体 → supabase/seed_creatures.sql（{len(sql)} バイト）')

import collections
print('条件つき:', dict(collections.Counter(
    ('水:'+r[8]) if r[8] else ('地:'+r[9]) if r[9] else '夜' if r[10] else '主' if r[11] else 'ベース'
    for r in rows)))
