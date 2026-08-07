/**
 * 海の生き物の絵。
 *
 * 324体を1枚ずつ描くのは無理なので、25種類の「形の型」に分けて
 * 色2色とサイズで描き分ける。どの型を使うかは creatures.family に入っている。
 *
 * 型を1つ直せば、その型を使う全部の生き物に反映される。
 * 「シーラカンスだけ形を変えたい」なら新しい型を足して family を差し替える。
 *
 * 絵は SVG ＋ CSS アニメーションだけで作る。canvas / WebGL は使わない。
 * requestAnimationFrame を回すとモバイルのバッテリーを食うし、
 * タブを裏に回してもCPUを占有し続ける。CSSならブラウザが勝手に止めてくれる。
 */

export type Family =
  | 'fish' | 'deep' | 'eel' | 'flat' | 'puffer' | 'shark' | 'ray' | 'turtle'
  | 'seahorse' | 'angler' | 'whale' | 'crab' | 'shrimp' | 'barnacle' | 'shell'
  | 'spiral' | 'octopus' | 'squid' | 'jelly' | 'star' | 'urchin' | 'cucumber'
  | 'weed' | 'coral' | 'worm';

/** 型ごとの [横幅, 高さ, 中身] */
type Shape = (a: string, b: string) => [number, number, string];

const ring = (cx: number, cy: number, c: string) =>
  `<circle cx="${cx}" cy="${cy}" r="5" fill="none" stroke="${c}" stroke-width="2"/>`;

const SHAPES: Record<Family, Shape> = {
  fish: (a, b) => [100, 52,
    `<path d="M26 26 L2 6 L10 26 L2 46Z" fill="${a}"/><ellipse cx="57" cy="26" rx="32" ry="14" fill="${b}"/><path d="M46 13 L64 4 L70 14Z" fill="${a}"/><circle cx="79" cy="22" r="3" fill="#1a1a1a"/>`],
  deep: (a, b) => [100, 60,
    `<path d="M24 30 L2 8 L2 52Z" fill="${a}"/><ellipse cx="57" cy="30" rx="32" ry="20" fill="${b}"/><path d="M42 11 L66 3 L74 13Z" fill="${a}"/><circle cx="80" cy="24" r="4" fill="#f2efe6"/><circle cx="80" cy="24" r="2.2" fill="#111"/>`],
  eel: (a, b) => [130, 40,
    `<path d="M6 20 C30 4 50 34 72 20 C92 7 110 26 126 18 C110 30 92 14 72 26 C50 40 30 12 6 20Z" fill="${b}"/><circle cx="120" cy="18" r="2.4" fill="#161616"/>`],
  flat: (a, b) => [96, 56,
    `<ellipse cx="48" cy="30" rx="42" ry="21" fill="${b}"/><path d="M8 30 Q48 6 88 30 Q48 54 8 30" fill="none" stroke="${a}" stroke-width="2"/><circle cx="70" cy="20" r="3.4" fill="#f0ede4"/><circle cx="70" cy="20" r="1.8" fill="#111"/><circle cx="79" cy="24" r="3" fill="#f0ede4"/><circle cx="79" cy="24" r="1.6" fill="#111"/>`],
  puffer: (a, b) => [86, 74,
    `<path d="M14 37 L2 22 L2 52Z" fill="${a}"/><circle cx="48" cy="37" r="30" fill="${b}"/><path d="M30 20 L34 26 M44 15 L45 22 M58 20 L54 26 M28 54 L33 49 M46 59 L46 52 M62 52 L56 48" stroke="${a}" stroke-width="2.4"/><circle cx="68" cy="30" r="4.4" fill="#f4f1e8"/><circle cx="69" cy="30" r="2.4" fill="#111"/>`],
  shark: (a, b) => [140, 54,
    `<path d="M30 27 L2 4 L12 27 L2 50Z" fill="${a}"/><ellipse cx="72" cy="27" rx="44" ry="13" fill="${b}"/><path d="M60 15 L74 1 L82 15Z" fill="${a}"/><path d="M64 39 L74 51 L82 38Z" fill="${a}"/><circle cx="104" cy="23" r="2.8" fill="#111"/>`],
  ray: (a, b) => [110, 74,
    `<path d="M55 6 C86 10 106 34 104 50 C88 44 74 42 55 42 C36 42 22 44 6 50 C4 34 24 10 55 6Z" fill="${b}"/><path d="M55 42 C57 56 58 66 56 72" stroke="${a}" stroke-width="4" fill="none"/><circle cx="46" cy="20" r="2.6" fill="#111"/><circle cx="64" cy="20" r="2.6" fill="#111"/>`],
  turtle: (a, b) => [104, 66,
    `<path d="M18 26 Q6 20 4 30 Q8 38 20 38 M84 26 Q98 20 100 32 Q94 40 84 38 M26 48 Q20 60 30 62 M78 48 Q86 60 76 62" fill="${a}"/><ellipse cx="52" cy="36" rx="32" ry="22" fill="${b}"/><path d="M52 14 L36 26 L42 44 L62 44 L68 26Z" fill="${a}" opacity=".5"/><ellipse cx="52" cy="8" rx="12" ry="9" fill="${a}"/><circle cx="46" cy="6" r="2" fill="#111"/>`],
  seahorse: (a, b) => [44, 84,
    `<path d="M22 10 C33 10 34 23 25 29 C14 37 13 49 19 57 C25 65 16 74 9 70" stroke="${b}" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M22 5 L32 2 L29 12Z" fill="${a}"/><circle cx="26" cy="11" r="2" fill="#221a0a"/>`],
  angler: (a, b) => [94, 72,
    `<path d="M20 42 L3 28 L3 56Z" fill="${a}"/><ellipse cx="50" cy="42" rx="28" ry="23" fill="${a}"/><path d="M32 51 Q52 63 73 48" stroke="#7d2b36" stroke-width="4" fill="none"/><path d="M36 50 L39 56 M46 53 L48 59 M58 54 L57 60" stroke="#efe6d2" stroke-width="2"/><path d="M56 20 C60 6 74 6 76 13" stroke="${a}" stroke-width="3" fill="none"/><circle cx="77" cy="14" r="6" fill="${b}"/><circle cx="62" cy="34" r="3.2" fill="#e9e1d1"/><circle cx="62" cy="34" r="1.6" fill="#111"/>`],
  whale: (a, b) => [160, 60,
    `<path d="M34 30 L4 6 L14 30 L4 54Z" fill="${a}"/><ellipse cx="92" cy="30" rx="56" ry="18" fill="${a}"/><path d="M82 14 L94 0 L104 14Z" fill="${a}"/><ellipse cx="106" cy="41" rx="30" ry="8" fill="${b}"/><ellipse cx="130" cy="24" rx="9" ry="4.2" fill="${b}"/><circle cx="138" cy="28" r="2.6" fill="#000"/>`],
  crab: (a, b) => [120, 72,
    `<path d="M46 40 Q26 26 8 18 M48 46 Q28 44 6 44 M46 52 Q28 62 10 70 M74 40 Q94 26 112 18 M72 46 Q92 44 114 44 M74 52 Q92 62 110 70" stroke="${a}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M44 32 Q28 18 20 22 Q26 32 40 38 M76 32 Q92 18 100 22 Q94 32 80 38" stroke="${a}" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="60" cy="46" rx="24" ry="16" fill="${b}"/><circle cx="52" cy="40" r="3" fill="#241206"/><circle cx="68" cy="40" r="3" fill="#241206"/>`],
  shrimp: (a, b) => [130, 54,
    `<path d="M42 26 Q14 8 2 3 M42 30 Q14 46 2 51" stroke="${a}" stroke-width="2.2" fill="none"/><path d="M38 14 L38 40 L96 40 Q104 26 96 14Z" fill="${b}"/><path d="M52 14 L52 40 M64 14 L64 40 M76 14 L76 40 M88 15 L88 39" stroke="${a}" stroke-width="2"/><path d="M96 13 L122 4 L126 27 L122 50 L96 41Z" fill="${a}"/><circle cx="44" cy="19" r="3" fill="#231008"/>`],
  barnacle: (a, b) => [76, 42,
    `<path d="M4 40 L15 13 L28 40Z" fill="${a}"/><path d="M24 40 L38 4 L54 40Z" fill="${b}"/><path d="M48 40 L60 16 L74 40Z" fill="${a}"/><circle cx="38" cy="12" r="3" fill="${a}"/>`],
  shell: (a, b) => [54, 42,
    `<path d="M27 40 C6 36 2 17 12 7 C20 0 34 0 42 7 C52 17 48 36 27 40Z" fill="${b}"/><path d="M27 40 L13 9 M27 40 L20 6 M27 40 L34 6 M27 40 L41 9" stroke="${a}" stroke-width="1.6"/>`],
  spiral: (a, b) => [62, 58,
    `<path d="M32 55 C10 51 3 30 14 16 C25 2 47 5 55 19 C63 33 52 51 32 55Z" fill="${a}"/><path d="M32 46 C19 43 17 29 25 21 C33 13 44 17 46 26 C48 35 42 44 32 46Z" fill="${b}"/><path d="M34 36 C29 35 28 30 31 27 C34 24 39 26 39 30 C39 34 37 36 34 36Z" fill="${a}"/>`],
  octopus: (a, b) => [92, 92,
    `<path d="M22 50 Q14 74 24 90 M36 56 Q30 78 38 92 M49 58 Q49 80 49 92 M62 56 Q68 78 60 92 M74 50 Q82 74 72 90" stroke="${a}" stroke-width="7" fill="none" stroke-linecap="round"/><ellipse cx="48" cy="33" rx="26" ry="24" fill="${b}"/><circle cx="38" cy="29" r="4.2" fill="#2a1512"/><circle cx="58" cy="29" r="4.2" fill="#2a1512"/>`],
  squid: (a, b) => [70, 112,
    `<path d="M19 64 Q13 90 19 110 M30 66 Q27 92 29 112 M41 66 Q44 92 42 112 M52 64 Q58 90 52 110" stroke="${a}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M35 6 C50 6 54 38 48 62 L23 62 C17 38 21 6 35 6Z" fill="${b}"/><path d="M11 29 Q35 12 59 29 Q35 23 11 29Z" fill="${a}"/><circle cx="28" cy="56" r="3.2" fill="#33232e"/><circle cx="43" cy="56" r="3.2" fill="#33232e"/>`],
  jelly: (a, b) => [80, 94,
    `<path d="M26 44 Q23 72 18 92 M39 46 Q39 76 39 94 M52 44 Q57 72 62 92" stroke="${b}" stroke-width="3" fill="none" opacity=".85"/><path d="M7 43 Q39 3 71 43 Q39 57 7 43Z" fill="${a}" opacity=".9"/>${ring(28, 34, b)}${ring(40, 30, b)}${ring(52, 34, b)}`],
  star: (a, b) => [70, 68,
    `<path d="M35 3 L45 26 L69 27 L50 42 L57 65 L35 51 L13 65 L20 42 L1 27 L25 26Z" fill="${b}"/><path d="M35 14 L41 29 L56 30 L44 39 L48 54 L35 45 L22 54 L26 39 L14 30 L29 29Z" fill="${a}" opacity=".55"/>`],
  urchin: (a, b) => {
    let g = '';
    for (let d = 0; d < 360; d += 30) {
      const r = (d * Math.PI) / 180;
      g += `<line x1="${(38 + 16 * Math.cos(r)).toFixed(1)}" y1="${(38 + 16 * Math.sin(r)).toFixed(1)}" x2="${(38 + 36 * Math.cos(r)).toFixed(1)}" y2="${(38 + 36 * Math.sin(r)).toFixed(1)}"/>`;
    }
    return [76, 76, `<g stroke="${a}" stroke-width="3" stroke-linecap="round">${g}</g><circle cx="38" cy="38" r="17" fill="${b}"/>`];
  },
  cucumber: (a, b) => [104, 36,
    `<path d="M8 20 Q8 6 26 6 L78 6 Q98 6 98 20 Q98 32 78 32 L26 32 Q8 32 8 20Z" fill="${a}"/><g fill="${b}"><circle cx="24" cy="11" r="3"/><circle cx="40" cy="9" r="3"/><circle cx="56" cy="11" r="3"/><circle cx="72" cy="9" r="3"/><circle cx="86" cy="13" r="3"/><circle cx="33" cy="28" r="2.6"/><circle cx="51" cy="29" r="2.6"/><circle cx="69" cy="28" r="2.6"/></g>`],
  weed: (a, b) => [70, 108,
    `<path d="M35 106 L35 8" stroke="${a}" stroke-width="4"/><path d="M35 92 C20 84 9 66 13 48 C23 58 32 72 35 92Z" fill="${a}"/><path d="M35 92 C50 84 61 66 57 48 C47 58 38 72 35 92Z" fill="${b}"/><path d="M35 58 C24 50 16 36 20 22 C28 32 33 44 35 58Z" fill="${a}"/><path d="M35 58 C46 50 54 36 50 22 C42 32 37 44 35 58Z" fill="${b}"/>`],
  coral: (a, b) => [94, 72,
    `<path d="M47 70 L47 42 M47 48 L26 29 M47 48 L68 29 M26 33 L14 15 M26 33 L36 13 M68 33 L80 15 M68 33 L58 13 M47 42 L47 11" stroke="${a}" stroke-width="7" fill="none" stroke-linecap="round"/><g fill="${b}"><circle cx="14" cy="13" r="5"/><circle cx="36" cy="11" r="5"/><circle cx="47" cy="9" r="5"/><circle cx="58" cy="11" r="5"/><circle cx="80" cy="13" r="5"/></g>`],
  worm: (a, b) => {
    const g = [16, 28, 40, 52, 64, 76]
      .map((x) => `<line x1="${x}" y1="10" x2="${x}" y2="4"/><line x1="${x}" y1="32" x2="${x}" y2="38"/>`)
      .join('');
    return [92, 42, `<path d="M6 22 C18 8 30 34 44 21 C58 8 70 32 86 20" stroke="${a}" stroke-width="11" fill="none" stroke-linecap="round"/><g stroke="${b}" stroke-width="2.4">${g}</g><circle cx="84" cy="19" r="2.4" fill="#2b1a14"/>`];
  },
};

export interface CreatureLike {
  family: string;
  color_a: string;
  color_b: string;
}

/**
 * 生き物1体を描く。
 * scale は「型の元サイズに対する倍率」。水槽では 0.46、図鑑では 0.27 くらい。
 */
export function Creature({ c, scale = 0.5 }: { c: CreatureLike; scale?: number }) {
  const shape = SHAPES[(c.family as Family)] ?? SHAPES.fish;
  const [w, h, inner] = shape(c.color_a, c.color_b);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={Math.round(w * scale)}
      style={{ overflow: 'visible', display: 'block' }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
