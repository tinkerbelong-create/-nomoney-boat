"""
324体の見た目を「形の型 × 色」に分解する。

1体ずつ絵を描くのは無理（品質も揃わない）。
形の型を20種類ほど用意して、色とサイズと少しのフラグで描き分ける。

    python3 docs/scripts/fish_shapes.py        判定結果を確認する
    python3 docs/scripts/fish_shapes.py --json ../data/creatures.json を書き出す

型の判定は名前から自動でやる。「〜ガニ」なら crab、「〜イカ」なら squid。
色も名前から拾う。アカ→赤、クロ→黒、コガネ→金。日本の魚の名前は
見た目がそのまま名前になっているものが多いので、これがよく当たる。

当たらないものは OVERRIDE に1行書いて上書きする。
"""
import os, json, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')

# ---- 形の型（20種類）----
FAMILIES = ['fish','deep','eel','flat','puffer','shark','ray','seahorse','angler','whale','turtle',
            'crab','shrimp','barnacle','shell','spiral','octopus','squid','jelly',
            'star','urchin','cucumber','weed','coral','worm']

# 名前に部分一致で判定するので、誤爆するものは先に名指しで押さえる。
#   オイカワ … 「イカ」を含むが淡水魚
#   ムラサメモンガラ … 「サメ」を含むがモンガラカワハギの仲間
EXCEPT = {'オイカワ':'fish', 'ムラサメモンガラ':'fish', 'モンガラカワハギ':'fish',
          'カワムツ':'fish', 'イサキ':'fish', 'ワカサギ':'fish',
          'アカニシ':'spiral',       # 「カニ」を含むが巻貝
          'アナジャコ':'shrimp',     # エビの仲間
          'オオグソクムシ':'worm', 'ダイオウグソクムシ':'worm',
          'アオウミガメ':'turtle', 'マンマルガメ':'turtle',
          'ハナギンチャク':'jelly', 'ウメボシイソギンチャク':'jelly'}

# 二枚貝と巻貝は「〜ガイ」で共通してしまうので、名指しで分ける
BIVALVE = ('アサリ','シジミ','ハマグリ','バカガイ','マテガイ','ムラサキイガイ',
           'ミルガイ','タイラギ','ホタテガイ','アカガイ','トリイガキ','カキ')
SPIRAL  = ('サザエ','トコブシ','シッタカ','イボニシ','レイシガイ','ツメタガイ','アカニシ',
           'バイガイ','アワビ','タマキビ','マツバガイ','ヒザラガイ','ウミウシ','オウムガイ')

# 名前の一部で型を決める。上から順に当てる
RULES = [
 (('シーラカンス',), 'deep'), (('チョウチンアンコウ','アンコウ'), 'angler'),
 (('タツノオトシゴ','シードラゴン','ウミテング'), 'seahorse'),
 (('クジラ','イルカ','シャチ','ジュゴン','イッカク','ゲイ'), 'whale'),
 (('ザメ','サメ','ラブカ','オオセ'), 'shark'),
 (('エイ','マンタ','イトマキエイ'), 'ray'),
 (('カレイ','ガレイ','ヒラメ','オヒョウ','シタビラメ'), 'flat'),
 (('フグ','ハコフグ','マンボウ'), 'puffer'),
 (('アナゴ','ウナギ','ウツボ','ハモ','ドジョウ','ギンポ','タチウオ','ヤガラ','ヤツメ'), 'eel'),
 (('ガニ','カニ','ガザミ','シャコ'), 'crab'),
 (('エビ','オキアミ','アミ','ヤドカリ'), 'shrimp'),
 (('フジツボ','カメノテ'), 'barnacle'),
 (BIVALVE, 'shell'),
 (SPIRAL, 'spiral'),

 (('イカ','コウイカ','オウムガイ','コブシメ'), 'squid'),
 (('クラゲ','ギンチャク','カツオノエボシ'), 'jelly'),
 (('ダコ','タコ'), 'octopus'),
 (('ヒトデ','クモヒトデ'), 'star'),
 (('ウニ','ガンガゼ'), 'urchin'),
 (('ナマコ','ホヤ'), 'cucumber'),
 (('ワカメ','コンブ','ノリ','アオサ','ヒジキ','モズク','テングサ','アマモ','スガモ','アラメ',
   'カジメ','ホンダワラ','マツモ','ミル','ウミブドウ','トサカ','シオグサ','ウミウチワ',
   'メカブ','カヤモノリ','ヒトエグサ','アオノリ'), 'weed'),
 (('サンゴ','ミドリイシ'), 'coral'),
 (('ゴカイ','イソメ','フナムシ','カブトガニ','ヨコエビ','ボヤ'), 'worm'),
]

# 名前に色が入っているものはそれを使う
# 名前の頭にある色語だけを見る。
# 「キ」を色語にすると キビナゴ・マカジキ・スズキ・イサキ が全部黄色になるので、
# 2文字以上かつ先頭一致に限定する。ここは一度やらかした。
COLORWORDS = [
 ('コガネ','#d8a93c'),('キイロ','#d9bb43'),('キン','#d8a93c'),('ギン','#c3ced6'),
 ('シロ','#e6e2d8'),('ハク','#e6e2d8'),('クロ','#3d444d'),('アカ','#c8503c'),('ベニ','#c8503c'),
 ('ルリ','#3f74a8'),('ミドリ','#4f9b6a'),('ムラサキ','#7a5c8f'),('アイゾメ','#2f4f80'),
]

# ★ごとの既定色。上ほど深い色にして、水槽を見たときに実力が伝わるようにする
STAR_TONE = {1:'#9aa79b',2:'#7f96a5',3:'#6d8ba0',4:'#5f7f9c',5:'#c26a4e',
             6:'#b0553f',7:'#3f5f86',8:'#33506e',9:'#3b3550',10:'#2b4a61'}

CAT_TONE = {'甲殻':'#a8563c','貝':'#a89268','海藻':'#5c8340','サンゴ':'#4f9b8e',
            'クラゲ':'#b9c8d8','棘皮':'#a2604f','その他':'#8a7a62'}

OVERRIDE = {
 'シーラカンス':('deep','#3d6a87','#9fc4d8'), 'ダイオウイカ':('squid','#8e4a52','#d6b3b8'),
 'リュウグウノツカイ':('eel','#d8dde2','#c0392b'), 'メガマウス':('shark','#4a4f5c','#cfd6dd'),
 'ジンベエザメ':('shark','#4c7089','#cfe0ea'), 'シャチ':('whale','#161616','#f1f1ee'),
 'マッコウクジラ':('whale','#4a4640','#c9c2b6'), 'ザトウクジラ':('whale','#39424c','#dfe3e6'),
 'イッカク':('whale','#7d8792','#e4e8ea'), 'ジュゴン':('whale','#8d8578','#cfc8ba'),
 'クマノミ':('fish','#e07b2a','#ffffff'), 'カクレクマノミ':('fish','#e8863a','#ffffff'),
 'ナンヨウハギ':('fish','#2a5fb0','#f0c419'), 'キイロハギ':('fish','#e0b52c','#f2d45e'),
 'ミノカサゴ':('fish','#a8492f','#f0e0c0'), 'ハナミノカサゴ':('fish','#b04f33','#f5e8cc'),
 'マダイ':('deep','#e59aa4','#f6cfd4'), 'クロダイ':('deep','#5a6672','#8a95a0'),
 'キンメダイ':('deep','#dd5340','#f7ecd0'), 'メダカ':('fish','#e6dfc4','#cfc7a8'),
 'キンギョ':('fish','#e2622f','#f6a05c'), 'デメキン':('fish','#c0392b','#e07b5c'),
 'チョウチンアンコウ':('angler','#342b3f','#f2e493'), 'ラブカ':('shark','#4a4250','#8a8090'),
 'ミツクリザメ':('shark','#c9a3a8','#e8d0d4'), 'デメニギス':('deep','#3c4a58','#7fd8c8'),
 'ダイオウグソクムシ':('worm','#8a7a5e','#c0b090'), 'コウモリダコ':('octopus','#6b2f3a','#a85560'),
 'センジュナマコ':('cucumber','#b06a70','#d89aa0'), 'フクロウナギ':('eel','#2e2a38','#5a5468'),
 'オンデンザメ':('shark','#5a5f66','#8d949b'), 'タツノオトシゴ':('seahorse','#d3a04a','#b7862f'),
 'リーフィーシードラゴン':('seahorse','#b9a03c','#8f7a2a'),
 'ウィーディーシードラゴン':('seahorse','#a8622f','#d1913f'),
 'カブトガニ':('worm','#6b4a30','#8f6a46'), 'オウムガイ':('spiral','#d8cbb0','#b0603f'),
 'ミズクラゲ':('jelly','#cfe4ef','#8fb9cf'), 'タコクラゲ':('jelly','#c3b2cf','#f0eaf4'),
 'エチゼンクラゲ':('jelly','#c9b9a8','#8f7f6e'), 'カツオノエボシ':('jelly','#7f8fd0','#b0bce8'),
 'シュモクザメ':('shark','#7a8994','#56646f'), 'ノコギリザメ':('shark','#8a9098','#5f666e'),
 'ホホジロザメ':('shark','#6c7883','#e8ece f'.replace(' ','')), 'イタチザメ':('shark','#5f6b74','#9aa4ac'),
 'マンボウ':('puffer','#8d97a0','#c2c9cf'), 'アカマンボウ':('puffer','#b8474a','#e8a05c'),
 'トラフグ':('puffer','#5a6068','#e8e4da'), 'クサフグ':('puffer','#6f7a52','#d8d2b8'),
 'ミドリフグ':('puffer','#6a9a4a','#d9c84a'),
 'イセエビ':('shrimp','#a8452f','#7d3221'), 'タラバガニ':('crab','#a8503a','#c9705a'),
 'ズワイガニ':('crab','#b06848','#d09070'), 'タカアシガニ':('crab','#b87355','#a4644a'),
 'クルマエビ':('shrimp','#c8b48a','#7a6a48'), 'アマエビ':('shrimp','#d9705c','#f0a08c'),
 'マダコ':('octopus','#b8635b','#a4534c'), 'ヒョウモンダコ':('octopus','#c8a84a','#3f5f9c'),
 'アオリイカ':('squid','#cdb9c8','#ab94a6'), 'ケンサキイカ':('squid','#d8c2b0','#b09a88'),
 'ウミブドウ':('weed','#5c9a4a','#7ab863'), 'ミドリイシ':('coral','#4f9b8e','#6dbdae'),
 'アカサンゴ':('coral','#c0483f','#d9705c'), 'シロサンゴ':('coral','#e0dcd0','#f0ece2'),
 'チンアナゴ':('eel','#e2d7bb','#6b5f45'), 'ニシキアナゴ':('eel','#e8c86a','#3d3a34'),
 'ナポレオンフィッシュ':('deep','#3f8a7a','#6dbdae'), 'ミズウオ':('eel','#8a92a0','#c8d0d8'),
 'オオカミウオ':('eel','#5a5248','#8a7f70'), 'ウツボ':('eel','#7a6a3a','#c8b878'),
 'タチウオ':('eel','#cfdae1','#a9b8c2'), 'オニヒトデ':('star','#8f4a5c','#c07a88'),
 'ガンガゼ':('urchin','#2e2a2e','#5a5058'), 'マナマコ':('cucumber','#6b4f45','#8d6a5c'),
}

def fam_of(name):
    if name in EXCEPT: return EXCEPT[name]
    for keys, f in RULES:
        for k in keys:
            if k in name: return f
    return 'fish'

def shade(hexc, amt):
    c = hexc.lstrip('#')
    r, g, b = (int(c[i:i+2], 16) for i in (0, 2, 4))
    f = lambda v: max(0, min(255, int(v + amt)))
    return '#%02x%02x%02x' % (f(r), f(g), f(b))

def colors_of(name, star, cat):
    if cat == '海藻':                       # 海藻は名前に関係なく緑系
        h = int(hashlib.md5(name.encode()).hexdigest()[:6], 16)
        g = shade('#5c8340', (h % 34) - 17)
        return g, shade(g, 54)
    for w, c in COLORWORDS:
        if name.startswith(w):              # 先頭一致だけ。途中一致はやらない
            return c, shade(c, 46)
    base = CAT_TONE.get(cat) or STAR_TONE[star]
    h = int(hashlib.md5(name.encode()).hexdigest()[:6], 16)
    return shade(base, (h % 40) - 20), shade(base, 52 + (h % 30))

# ===================== 生成と検証 =====================
ns = {}
exec(open(os.path.join(HERE, 'fish_species.py'), encoding='utf-8').read().split('# ===================== 検証')[0], ns)
lo = {}
exec(open(os.path.join(HERE, 'venue_lords.py'), encoding='utf-8').read().split('# ===================== 検証')[0], lo)
cond = {}
exec(open(os.path.join(HERE, 'fish_conditions.py'), encoding='utf-8').read().split('# ===================== 検証')[0], cond)
COND, VENUE = cond['COND'], cond['VENUE']
WHERE = {n: c for c, names in COND.items() for n in names}

MOVE = {'魚':'swim','頭足':'swim','海獣':'swim','クラゲ':'float',
        'クラゲ ':'float','甲殻':'crawl','棘皮':'crawl','貝':'crawl','その他':'crawl',
        '海藻':'fix','サンゴ':'fix'}
# 型で動きを上書きする例外。縦長・砂に埋まるものは固定扱いにする
MOVE_BY_FAM = {'seahorse':'float','barnacle':'fix','weed':'fix','coral':'fix','turtle':'swim',
               'shell':'crawl','jelly':'float','worm':'crawl'}

out, err = [], []
for s in range(1, 11):
    for name, cat in ns['SPECIES'][s]:
        fam, c1, c2 = OVERRIDE.get(name, (None, None, None))
        if fam is None:
            fam = fam_of(name); c1, c2 = colors_of(name, s, cat)
        mv = MOVE_BY_FAM.get(fam) or MOVE[cat]
        out.append({'n': name, 's': s, 'c': cat, 'f': fam, 'a': c1, 'b': c2,
                    'm': mv, 'w': WHERE.get(name, '')})
for code, vn, name, kj, cat, moto, desc in lo['LORDS']:
    fam, c1, c2 = OVERRIDE.get(name, (None, None, None))
    if fam is None:
        fam = fam_of(name); c1, c2 = colors_of(name, 10, cat)
    out.append({'n': name, 's': 10, 'c': cat, 'f': fam, 'a': c1, 'b': c2,
                'm': MOVE_BY_FAM.get(fam) or MOVE[cat], 'w': f'主:{vn}', 'k': kj, 'd': desc})

# 検証
if len(out) != 324: err.append(f'{len(out)}体（324のはず）')
if len({o['n'] for o in out}) != 324: err.append('名前が重複')
for o in out:
    if o['f'] not in FAMILIES: err.append(f'{o["n"]}: 未知の型 {o["f"]}')
    if not (o['a'].startswith('#') and len(o['a']) == 7): err.append(f'{o["n"]}: 色が不正 {o["a"]}')
    if o['m'] not in ('swim','float','crawl','fix'): err.append(f'{o["n"]}: 未知の動き')

import collections
print('=' * 70)
print('検証:', '全項目パス' if not err else f'{len(err)}件')
for e in err[:10]: print('  NG', e)
print('=' * 70)
print(f'\n合計 {len(out)}体\n')
fc = collections.Counter(o['f'] for o in out)
print('形の型ごと（' + str(len(fc)) + '種類）')
for k, v in fc.most_common():
    print(f'  {k:<10}{v:>4}体   例: ' + '・'.join(o['n'] for o in out if o['f'] == k)[:46])
print()
mc = collections.Counter(o['m'] for o in out)
print('動きごと:', '  '.join(f'{k} {v}体' for k, v in mc.most_common()))
print(f'\n水槽1つに30体まで → 全部飾るには {-(-len(out)//30)} 水槽ひつよう')

if '--json' in sys.argv:
    with open(os.path.join(DATA, 'creatures.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('\n→ docs/data/creatures.json を書き出した', os.path.getsize(os.path.join(DATA,'creatures.json')), 'バイト')
