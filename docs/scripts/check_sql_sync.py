"""
設計スクリプトと SQL がズレていないか調べる。

    python3 docs/scripts/check_sql_sync.py

排出率もグレード表も、Python側（設計・検証用）と SQL側（実際に動く方）の
2か所に同じ数字が書いてある。片方だけ直すと、
「検証は通っているのに本番の挙動が違う」という一番たちの悪いズレになる。

数字を変えたら、必ずこれを走らせて「全項目パス」を確認すること。
"""
import os, re, sys, ast

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')

def load(name):
    ns = {}
    src = open(os.path.join(HERE, name), encoding='utf-8').read()
    exec(src.split('# ===================== 検証')[0], ns)
    return ns

def sql(name):
    return open(os.path.join(ROOT, 'supabase', name), encoding='utf-8').read()

err = []

# ---- fish_rates.py と 0018 の creature_rates ----
rates = load('fish_rates.py')
s = sql('migrations/0018_aquarium.sql')
for g, w in rates['DIST'].items():
    want = '{' + ','.join(str(x) for x in w) + '}'
    if want not in s:
        err.append(f'排出率 G{g} が 0018_aquarium.sql に無い / 違う\n      期待: {want}')

# ---- グレード表 ----
for r, row in rates['GRID'].items():
    for si, g in enumerate(row, start=1):
        if f'({r},{si},{g})' not in s.replace(' ', ''):
            err.append(f'グレード表 R{r}S{si}=G{g} が SQL と違う')

# ---- 天井 ----
for r, cap in rates['GRADE_CAP'].items():
    if f'({r},{cap})' not in s.replace(' ', ''):
        err.append(f'天井 R{r}={cap} が SQL と違う')

# ---- 等級ボーナス ----
for code, b in rates['GRADE_BONUS'].items():
    if f"('{code}',{b})" not in s.replace(' ', ''):
        err.append(f'等級ボーナス {code}=+{b} が SQL と違う')

# ---- 場の属性（水質・地区）----
cond = load('fish_conditions.py')
for code, (name, area, water) in cond['VENUE'].items():
    if f"('{code}','{name}','{area}','{water}')" not in s.replace(' ', ''):
        err.append(f'場の属性 {code} {name} が SQL と違う')

# ---- 掛け金帯・倍率帯（0019）----
s2 = sql('migrations/0019_creature_award.sql')
for bound in ('1000', '800', '500', '200'):
    if f'p_stake >= {bound.rjust(4)}' not in s2 and f'p_stake >=  {bound}' not in s2 and f'p_stake >= {bound}' not in s2:
        err.append(f'掛け金帯の境界 {bound} が 0019 に無い')
for bound in ('1000', '500', '300', '100', '30', '10'):
    if f'p_ratio >= {bound}' not in s2.replace('  ', ' '):
        err.append(f'倍率帯の境界 {bound} が 0019 に無い')

# ---- seed の体数 ----
try:
    seed = sql('seed_creatures.sql')
    n = seed.count("\n  ('")
    if n != 324:
        err.append(f'seed_creatures.sql が {n} 体（324のはず）。creatures_seed.py を実行し直す')
except FileNotFoundError:
    err.append('seed_creatures.sql が無い。python3 docs/scripts/creatures_seed.py を実行する')

# ---- 水槽の定員（SQL と TypeScript）----
if 'select 30' not in s:
    err.append('tank_capacity() が 30 でない')
ts = open(os.path.join(ROOT, 'apps/web/src/lib/aquarium.ts'), encoding='utf-8').read()
m = re.search(r'TANK_CAPACITY = (\d+)', ts)
if not m or m.group(1) != '30':
    err.append(f'aquarium.ts の TANK_CAPACITY が SQL と違う（{m.group(1) if m else "見つからない"}）')

print('=' * 70)
print('SQL との同期:', '全項目パス' if not err else f'{len(err)}件のズレ')
for e in err:
    print('  NG', e)
print('=' * 70)
if not err:
    print('\n  排出率10行 / グレード表35マス / 天井7件 / 等級ボーナス6件')
    print('  / 場の属性24件 / 倍率帯6件 / 掛け金帯4件 / seed 324体 / 定員30')
    print('  すべて Python と SQL で一致している。')
sys.exit(1 if err else 0)
