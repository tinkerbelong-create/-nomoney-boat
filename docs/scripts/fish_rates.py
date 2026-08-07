"""
魚の排出率テーブルを生成し、矛盾がないか検証する。

    python3 docs/scripts/fish_rates.py

数字を変えたくなったら、いじるのは MU / SIGMA / STAR10 / STAR9 / GRID だけ。
実行すると10項目の検証が走るので、「全項目パス」が出ることを必ず確認する。
出力の最後に、そのままSQLに貼れる配列も出る。

検証している10項目は docs/aquarium-design.md の 2.3 に書いてある。
とくに大事なのが FOSD（確率的単調性）で、
これが崩れると「グレードが上がったのに良い魚が出にくくなる」という、
遊んでいて気づかれる種類の矛盾になる。
"""
import math

# ---- グレード表：倍率7段 × 掛け金3段（500pt以上で頭打ち） ----
GRID = {
 7: [8, 8,  9,  9, 10],   # 1000倍以上
 6: [7, 7,  8,  8,  9],   # 500〜1000
 5: [6, 6,  7,  7,  8],   # 300〜500
 4: [5, 5,  6,  6,  6],   # 100〜300
 3: [3, 4,  4,  5,  5],   # 30〜100
 2: [2, 2,  3,  3,  4],   # 10〜30
 1: [1, 1,  1,  2,  2],   # 10倍未満
}
# 100倍未満(R1..R3)で到達しうる最大グレード = 5  → G1..G5 は★10ゼロ
MAX_G_UNDER_100 = max(max(GRID[r]) for r in (1,2,3))
assert MAX_G_UNDER_100 == 5, MAX_G_UNDER_100


# ---------------------------------------------------------------------
# 等級（SG / G1 / G2 / G3 / 一般）は「限定の魚」ではなく「★の出やすさ」を動かす。
#
# 等級ごとに限定の魚を置くのはやめた。
# 「キンメダイがG2でしか出ない」理由が自然界になく、説明できないため。
# 代わりにグレードを底上げする。同じ的中でも、SG開催なら少し良い魚が出る。
#
# ただし倍率の壁は越えない。等級で★10のルールが壊れては意味がないので、
# 倍率帯ごとに上限を置いて、そこで頭を止める。
# ---------------------------------------------------------------------

GRADE_BONUS = {'一般': 0, 'G3': 1, 'G2': 2, 'G1': 3, 'SG': 4}

# 倍率帯ごとのグレード上限。★10のルールを守るための天井。
#   R1〜R3（100倍未満）→ G5 まで  … G1〜G5 は★10が0%。等級では絶対に破れない
#   R4（100〜300倍）  → G6 まで  … ★10は3%どまり
#   R5〜R7            → G9 まで
#   1000倍 × 1000pt のマスだけ G10（★10確定）。ここは等級では買えない
GRADE_CAP = {1: 5, 2: 5, 3: 5, 4: 6, 5: 8, 6: 9, 7: 9}

def final_grade(R, S, grade='一般'):
    """R:倍率1-7  S:掛け金1-5  → 最終グレード1-10"""
    base = GRID[R][S - 1]
    cap = 10 if (R == 7 and S == 5) else GRADE_CAP[R]
    return min(base + GRADE_BONUS[grade], cap)

# ---- 連続分布 → 整数% ----
MU    = {1:1.25, 2:2.15, 3:3.05, 4:4.00, 5:5.00, 6:6.05, 7:7.10, 8:8.15, 9:9.05}
SIGMA = {1:0.75, 2:0.85, 3:0.95, 4:1.00, 5:1.00, 6:1.00, 7:0.98, 8:0.92, 9:0.72}
STAR10 = {6:3, 7:6, 8:15, 9:40}
STAR9  = {6:5}

def largest_remainder(w, total=100, lock=None):
    lock = lock or {}
    free_total = total - sum(lock.values())
    idx = [i for i in range(10) if (i+1) not in lock]
    s = sum(w[i] for i in idx)
    raw = {i: w[i]/s*free_total for i in idx}
    out = {i: int(math.floor(raw[i])) for i in idx}
    rem = free_total - sum(out.values())
    for i in sorted(idx, key=lambda i: -(raw[i]-math.floor(raw[i]))):
        if rem <= 0: break
        out[i] += 1; rem -= 1
    row = [0]*10
    for i, v in out.items(): row[i] = v
    for k, v in lock.items(): row[k-1] = v
    return row

DIST = {}
for g in range(1, 10):
    w = [math.exp(-((k-MU[g])**2)/(2*SIGMA[g]**2)) for k in range(1, 11)]
    if g <= 5: w[9] = 0.0                      # ★10 を完全に封じる
    for k in range(10):
        if w[k] < 0.004: w[k] = 0.0            # 極小の裾を切る
    lock = {}
    if g in STAR10: lock[10] = STAR10[g]
    if g in STAR9:  lock[9]  = STAR9[g]
    DIST[g] = largest_remainder(w, 100, lock)
DIST[10] = [0]*9 + [100]                        # 1000倍 × 500pt以上 → ★10 確定

# ================= 検証 =================
def tail(d, t):            # P(★ >= t)
    return sum(d[t-1:])

errors = []

# 1. 各行の合計がちょうど100
for g, d in DIST.items():
    if sum(d) != 100: errors.append(f'G{g}: 合計が{sum(d)}')

# 2. 負の値・確率でない値がない
for g, d in DIST.items():
    if any(x < 0 for x in d): errors.append(f'G{g}: 負の値')

# 3. FOSD（確率的単調性）: どの★閾値で見てもGが上がれば確率が下がらない
for g in range(1, 10):
    for t in range(1, 11):
        a, b = tail(DIST[g], t), tail(DIST[g+1], t)
        if b < a: errors.append(f'G{g}→G{g+1} の P(★>={t}) が {a}→{b} と減少')

# 4. 期待値が厳密に単調増加
ev = {g: sum((i+1)*p for i, p in enumerate(d))/100 for g, d in DIST.items()}
for g in range(1, 10):
    if not ev[g+1] > ev[g]: errors.append(f'期待値 G{g}={ev[g]} → G{g+1}={ev[g+1]}')

# 5. ★10 のゲート
for g in range(1, 6):
    if DIST[g][9] != 0: errors.append(f'G{g} で★10が{DIST[g][9]}%（100倍未満は0%のはず）')
if DIST[6][9] != 3: errors.append('G6の★10が3%でない')
if DIST[10][9] != 100: errors.append('G10の★10が100%でない')

# 6. 100倍未満の全マスで★10が0
for r in (1,2,3):
    for g in GRID[r]:
        if DIST[g][9] != 0: errors.append(f'倍率ランク{r}のマスG{g}で★10が出る')

# 7. グリッドの単調性（右へ・上へ行ってグレードが下がらない）
for r in GRID:
    for s in range(4):
        if GRID[r][s+1] < GRID[r][s]: errors.append(f'R{r}: 掛け金で減少')
for r in range(1, 7):
    for s in range(5):
        if GRID[r+1][s] < GRID[r][s]: errors.append(f'S{s+1}: 倍率で減少')

# 8. ピークが飛ばずに1つずつ動く
peaks = [max(range(10), key=lambda i: DIST[g][i])+1 for g in range(1, 11)]
for i in range(9):
    if not (0 <= peaks[i+1]-peaks[i] <= 2): errors.append(f'ピーク跳び G{i+1}:★{peaks[i]} → G{i+2}:★{peaks[i+1]}')

print('=' * 74)
print('検証結果:', '全項目パス' if not errors else f'{len(errors)}件の矛盾')
for e in errors: print('  NG', e)
print('=' * 74)
print()
hdr = '  G |' + ''.join(f'{"★"+str(k):>5}' for k in range(1, 11)) + ' |  期待値 | ピーク'
print(hdr); print('-'*len(hdr))
for g in range(1, 11):
    d = DIST[g]
    print(f'{g:>3} |' + ''.join(f'{(str(x) if x else "·"):>5}' for x in d)
          + f' |  ★{ev[g]:.2f} |  ★{peaks[g-1]}')
print()
print('累積 P(★>=t) — 各列が下に向かって単調増加していることを確認')
hdr2 = '  G |' + ''.join(f'{">="+str(t):>5}' for t in range(2, 11))
print(hdr2); print('-'*len(hdr2))
for g in range(1, 11):
    print(f'{g:>3} |' + ''.join(f'{tail(DIST[g],t):>5}' for t in range(2, 11)))

# ---- 追加検証 9: 単峰性（ピークまで非減少・ピーク後は非増加）----
# 10: 穴がない（0でない値のあいだに0が挟まらない）
extra = []
for g, d in DIST.items():
    pk = max(range(10), key=lambda i: d[i])
    for i in range(pk):
        if d[i] > d[i+1]: extra.append(f'G{g}: ★{i+1}({d[i]})>★{i+2}({d[i+1]}) — ピーク前で減少')
    for i in range(pk, 9):
        if d[i] < d[i+1]: extra.append(f'G{g}: ★{i+1}({d[i]})<★{i+2}({d[i+1]}) — ピーク後で増加')
    nz = [i for i, x in enumerate(d) if x > 0]
    if nz and any(d[i] == 0 for i in range(nz[0], nz[-1]+1)):
        extra.append(f'G{g}: 分布に穴がある {d}')

print()
print('=' * 74)
print('追加検証（単峰性・穴なし）:', '全項目パス' if not extra else f'{len(extra)}件')
for e in extra: print('  NG', e)
print('=' * 74)
print()
RL = {7:'1000倍以上',6:'500〜1000倍',5:'300〜500倍',4:'100〜300倍',3:'30〜100倍',2:'10〜30倍',1:'10倍未満'}
SL = ['100pt','200〜400pt','500〜700pt','800〜900pt','1000pt〜']
print('35マスのグレードと★10の確率')
print(f'{"倍率":<14}' + ''.join(f'{s:>15}' for s in SL))
print('-'*68)
for r in range(7, 0, -1):
    line = f'{RL[r]:<12}'
    for s in range(5):
        g = GRID[r][s]
        line += f'{"G"+str(g)+" ("+str(DIST[g][9])+"%)":>15}'
    print(line)

# ---- 等級補正の検証 ----
gerr = []
GR = ['一般', 'G3', 'G2', 'G1', 'SG']

# 基本の表が天井を超えていないこと
for R in range(1, 8):
    for S in range(1, 6):
        cap = 10 if (R == 7 and S == 5) else GRADE_CAP[R]
        if GRID[R][S-1] > cap: gerr.append(f'R{R}S{S}: 基本表G{GRID[R][S-1]} > 天井{cap}')

# 単調性：倍率・掛け金・等級のどれを上げても最終グレードが下がらない
for g in GR:
    for R in range(1, 8):
        for S in range(1, 5):
            if final_grade(R,S+1,g) < final_grade(R,S,g): gerr.append(f'{g} R{R}: 掛け金で減少')
    for S in range(1, 6):
        for R in range(1, 7):
            if final_grade(R+1,S,g) < final_grade(R,S,g): gerr.append(f'{g} S{S}: 倍率で減少')
for R in range(1, 8):
    for S in range(1, 6):
        for i in range(4):
            if final_grade(R,S,GR[i+1]) < final_grade(R,S,GR[i]): gerr.append(f'R{R}S{S}: 等級で減少')

# ★10のルールが等級で破られていないこと
for g in GR:
    for R in range(1, 4):
        for S in range(1, 6):
            if DIST[final_grade(R,S,g)][9] != 0:
                gerr.append(f'{g} R{R}S{S}: 100倍未満なのに★10が出る')
    for S in range(1, 6):
        if DIST[final_grade(4,S,g)][9] > 3: gerr.append(f'{g} R4S{S}: 100倍帯で★10が3%超')
    for S in range(1, 5):
        if DIST[final_grade(7,S,g)][9] == 100: gerr.append(f'{g} R7S{S}: 1000pt未満で★10確定')

print()
print('=' * 74)
print('等級補正の検証:', '全項目パス' if not gerr else f'{len(gerr)}件')
for e in gerr: print('  NG', e)
print('=' * 74)
RLB = {7:'1000倍以上',6:'500〜1000',5:'300〜500',4:'100〜300',3:'30〜100',2:'10〜30',1:'10倍未満'}
for g in GR:
    print(f'\n【{g}】 ボーナス +{GRADE_BONUS[g]}')
    print(f'  {"倍率":<12}' + ''.join(f'{s:>12}' for s in ['100pt','200〜400','500〜700','800〜900','1000pt〜']))
    for R in range(7, 0, -1):
        line = f'  {RLB[R]:<11}'
        for S in range(1, 6):
            fg = final_grade(R, S, g)
            line += f'{"G"+str(fg)+"("+str(DIST[fg][9])+"%)":>12}'
        print(line)
