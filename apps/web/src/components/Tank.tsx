'use client';

/**
 * 動く水槽。
 *
 * 生き物をタップすると「いつ・どこで・どの買い目で・いくらの払戻で取ったか」が出る。
 * 水槽は成績表ではなく、記録の博物館として見せたい。
 *
 * 動きは4種類しかない。カテゴリではなく creatures.move で決まる。
 *   swim  中層を横断しながら上下に揺れる
 *   float 上層をゆっくり漂いながら伸縮する
 *   crawl 底を左右に往復する
 *   fix   底に固定されて揺れるだけ
 *
 * 324体ぶんのアニメーションは作らない。1体につき持つのは絵と色とサイズだけ。
 *
 * すべて CSS アニメーション。requestAnimationFrame は使わない。
 * タブを裏に回したときにブラウザが勝手に止めてくれるほうが、
 * モバイルのバッテリーにも無料枠にもやさしい。
 */

import { useState } from 'react';
import { Creature } from '@/components/Creature';
import { STAR_LABEL, BET_LABEL, TANK_CAPACITY, type TankRow } from '@/lib/aquarium';
import { fmtPt } from '@/lib/format';

const TANK_H = 300;

/** 名前から決まる擬似乱数。同じ生き物はいつも同じレーンを泳ぐ */
function seed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Tank({ items }: { items: TankRow[] }) {
  const [sel, setSel] = useState<TankRow | null>(null);

  if (items.length === 0) {
    return (
      <div className="mx-4 rounded-2xl bg-[#0f3c4e] px-6 py-14 text-center">
        <p className="text-3xl">🫧</p>
        <p className="mt-3 text-sm font-semibold text-white">まだ何もいません</p>
        <p className="mt-1 text-xs leading-relaxed text-white/70">
          レースを当てると、海の生き物が1体もらえます。
          <br />
          当てた払戻が高いほど、めずらしいものが出ます。
        </p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes tk-sw  { from { transform: translateX(-170px) } to { transform: translateX(105%) } }
        @keyframes tk-swb { from { transform: translateX(105%) scaleX(-1) } to { transform: translateX(-170px) scaleX(-1) } }
        @keyframes tk-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-9px) } }
        @keyframes tk-df  { 0%,100% { transform: translate(0,0) } 50% { transform: translate(20px,-34px) } }
        @keyframes tk-pl  { 0%,100% { transform: scaleY(1) } 50% { transform: scaleY(.85) } }
        @keyframes tk-cr  { 0%,100% { transform: translateX(0) } 50% { transform: translateX(38px) } }
        @keyframes tk-sy  { 0%,100% { transform: rotate(-5deg) } 50% { transform: rotate(5deg) } }
        @media (prefers-reduced-motion: reduce) {
          .tk-a, .tk-a * { animation: none !important }
        }
      `}</style>

      <div
        className="relative mx-4 overflow-hidden rounded-2xl"
        style={{ height: TANK_H, background: '#0f3c4e' }}
      >
        {/* 水の層。深いところほど暗い。★の高いものを下に置くと映える */}
        <div className="absolute inset-x-0 top-0" style={{ height: 92, background: '#17566d' }} />
        <div className="absolute inset-x-0" style={{ top: 92, height: 108, background: '#124a5f' }} />
        <div className="absolute inset-x-0 bottom-0" style={{ top: 200, background: '#0d3243' }} />
        <div className="absolute inset-x-0 bottom-0" style={{ height: 24, background: '#c2ae86' }} />

        {items.map((c, i) => {
          const h = seed(c.code);
          const common = {
            key: c.code,
            className: 'tk-a absolute cursor-pointer',
            onClick: () => setSel(c),
          };

          if (c.move === 'swim') {
            const dur = 15 + (h % 13);
            // ★が高いほど深い層を泳ぐ。水槽を見ただけで実力が伝わる
            const top = 10 + Math.round(((11 - c.star) / 10) * 150) + (h % 20);
            return (
              <div
                {...common}
                style={{
                  top,
                  left: 0,
                  animation: `${i % 2 ? 'tk-swb' : 'tk-sw'} ${dur}s linear infinite`,
                  animationDelay: `-${(h % (dur * 10)) / 10}s`,
                }}
              >
                <div style={{ animation: `tk-bob ${2.3 + (h % 5) * 0.4}s ease-in-out infinite` }}>
                  <Creature c={c} scale={0.46} />
                </div>
              </div>
            );
          }

          if (c.move === 'float') {
            return (
              <div
                {...common}
                style={{
                  left: `${6 + (h % 78)}%`,
                  top: 12 + (h % 3) * 30,
                  animation: `tk-df ${9 + (h % 6)}s ease-in-out infinite`,
                  animationDelay: `-${h % 9}s`,
                }}
              >
                <div
                  style={{
                    animation: `tk-pl ${2.6 + (h % 3) * 0.5}s ease-in-out infinite`,
                    transformOrigin: '50% 18%',
                  }}
                >
                  <Creature c={c} scale={0.44} />
                </div>
              </div>
            );
          }

          if (c.move === 'crawl') {
            return (
              <div
                {...common}
                style={{
                  left: `${4 + (h % 76)}%`,
                  bottom: 10,
                  animation: `tk-cr ${11 + (h % 7)}s ease-in-out infinite`,
                  animationDelay: `-${h % 11}s`,
                }}
              >
                <Creature c={c} scale={0.42} />
              </div>
            );
          }

          return (
            <div
              {...common}
              style={{
                left: `${4 + (h % 78)}%`,
                bottom: 8,
                transformOrigin: '50% 100%',
                animation: `tk-sy ${4 + (h % 4) * 0.8}s ease-in-out infinite`,
                animationDelay: `-${h % 5}s`,
              }}
            >
              <Creature c={c} scale={0.42} />
            </div>
          );
        })}
      </div>

      <p className="px-4 pt-2 text-center text-[11px] text-sub">
        {items.length} / {TANK_CAPACITY} 体
        {items.length >= TANK_CAPACITY
          ? '満員です。これ以上は図鑑にだけ増えていきます'
          : 'タップすると、いつどこで取ったかが出ます'}
      </p>

      {sel && <Detail c={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function Detail({ c, onClose }: { c: TankRow; onClose: () => void }) {
  const m = c.meta ?? {};
  const rows: [string, string][] = [];
  if (m.deadline) {
    const d = new Date(m.deadline);
    rows.push(['取った日', `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`]);
  }
  if (m.venue) rows.push(['レース', `${m.venue} ${m.raceNo ?? ''}R${m.raceGrade ? `（${m.raceGrade}）` : ''}`]);
  if (m.betType) rows.push(['買い目', `${BET_LABEL[m.betType] ?? m.betType}　${m.selection ?? ''}`]);
  if (m.stake) rows.push(['賭けた額', fmtPt(m.stake)]);
  if (m.payout != null) rows.push(['払戻', `${fmtPt(m.payout)}（${m.ratio ?? '—'}倍）`]);

  return (
    <div className="mx-4 mt-3 rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="flex w-[76px] shrink-0 justify-center">
          <Creature c={c} scale={0.56} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold">{c.name}</span>
            {c.count > 1 && <span className="text-xs text-sub">×{c.count}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
              ★{c.star} {STAR_LABEL[c.star]}
            </span>
            <span className="text-[10px] text-sub">{c.category}</span>
          </div>
        </div>
        <button onClick={onClose} className="shrink-0 text-xs text-sub" aria-label="閉じる">
          閉じる
        </button>
      </div>

      {rows.length > 0 ? (
        <dl className="tabnum mt-3 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-sub">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-xs text-sub">この子の記録はまだありません。</p>
      )}
    </div>
  );
}
