'use client';

/**
 * 投票パネル。
 *
 * 実際のボートレース投票サイトの操作感に寄せている。
 *   賭け式を選ぶ → 買い方（通常/ボックス/ながし）→ 艇を選ぶ → 点数 → 確認
 *
 * 買い目の組み立ては src/core の関数をそのまま使う。
 * サーバ側も同じ関数で正規化するので、表示と保存が食い違うことがない。
 */

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  BOATRACE_BET_TYPES,
  getBoatraceBetType,
  normalizeSelection,
  expandBox,
  expandNagashi,
  expandFormation,
  parseSelection,
  combinationCount,
  estimatePayout,
  STAKE_UNIT,
  type OddsMap,
} from '@/core';
import { placeBets } from '@/app/actions';
import { fmtPt, laneClass } from '@/lib/format';
import { settleWaitingText } from '@/lib/settings';

type Mode = 'normal' | 'box' | 'nagashi' | 'formation';

interface Props {
  eventId: string;
  markets: { id: string; betTypeCode: string; minStake: number; stakeStep: number }[];
  lanes: string[];
  balance: number;
  deadline: string;
  serverNow: number;
  /** 公式サイトのオッズページ。取得できなかったときの逃げ道として出す。 */
  officialOddsUrl?: string;
  /** お題レースの倍率。ふつうのレースでは undefined */
  featureMultiplier?: number;
  /** お題レースで、あと何pt使えるか */
  featureRemain?: number;
}

const QUICK_STAKES = [100, 500, 1000, 5000];

export function BetPanel({
  eventId,
  markets,
  lanes,
  balance,
  officialOddsUrl,
  featureMultiplier,
  featureRemain,
}: Props) {
  const available = BOATRACE_BET_TYPES.filter((bt) =>
    markets.some((m) => m.betTypeCode === bt.code),
  );

  const [betTypeCode, setBetTypeCode] = useState(available[0]?.code ?? 'trifecta');
  const [mode, setMode] = useState<Mode>('normal');
  const [ordered, setOrdered] = useState<string[]>([]); // 通常買いの着順つき選択
  const [picked, setPicked] = useState<string[]>([]);   // ボックス/ながしの相手
  const [axis, setAxis] = useState<string | null>(null);
  // フォーメーション。着位ごとの候補。[1着候補, 2着候補, 3着候補]
  const [formation, setFormation] = useState<string[][]>([[], [], []]);
  const [stake, setStake] = useState(100);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // オッズ。賭け式を切り替えるたびに、その賭け式のぶんだけ取りに行く。
  // サーバ側で90秒キャッシュされるので、何度切り替えても負荷は増えない。
  const [odds, setOdds] = useState<OddsMap>({});
  const [oddsUpdatedAt, setOddsUpdatedAt] = useState<string | null>(null);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsError, setOddsError] = useState<string | null>(null);
  /** 最後に取りに行った時刻。「いつの数字か」を出すため。 */
  const [oddsCheckedAt, setOddsCheckedAt] = useState<Date | null>(null);

  /**
   * オッズを取りに行く。
   *
   * オッズは締切間際まで動き続けるが、常時取りに行くと公式サイトの負担になる。
   * ふだんは開いたときと2分おきに更新し、それ以外は「更新」ボタンで取り直す。
   */
  const loadOdds = (force = false) => {
    setOddsLoading(true);
    setOddsError(null);

    return fetch(`/api/odds/${eventId}?bt=${betTypeCode}${force ? '&fresh=1' : ''}`)
      .then((r) => r.json())
      .then((d) => {
        setOdds(d.odds ?? {});
        setOddsUpdatedAt(d.updatedAt ?? null);
        setOddsError(d.error ?? d.detail ?? null);
        setOddsCheckedAt(new Date());
      })
      .catch((e) => setOddsError(String(e)))
      .finally(() => setOddsLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    setOdds({});

    const run = (force: boolean) => {
      if (cancelled) return;
      void loadOdds(force);
    };

    run(false);

    // 締切前はときどき取り直す
    const id = setInterval(() => run(true), 120_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, betTypeCode]);

  const betType = getBoatraceBetType(betTypeCode);
  const market = markets.find((m) => m.betTypeCode === betTypeCode)!;
  const isSingle = betType.selectionKind === 'single';

  const reset = () => {
    setOrdered([]);
    setPicked([]);
    setAxis(null);
    setFormation([[], [], []]);
    setMessage(null);
  };

  const switchBetType = (code: string) => {
    setBetTypeCode(code);
    setMode('normal');
    reset();
  };

  /** 現在の選択から実際に買う買い目を組み立てる */
  const selections = useMemo<string[][]>(() => {
    try {
      if (isSingle) return ordered.length === 1 ? [[ordered[0]!]] : [];

      if (mode === 'normal') {
        return ordered.length === betType.pickCount ? [ordered] : [];
      }

      if (mode === 'box') {
        if (picked.length < betType.pickCount) return [];
        return expandBox(betType, picked).map((s) => parseSelection(betType, s));
      }

      if (mode === 'formation') {
        const groups = formation.slice(0, betType.pickCount);
        if (groups.some((g) => g.length === 0)) return [];
        return expandFormation(betType, groups).map((s) => parseSelection(betType, s));
      }

      // ながし
      if (!axis || picked.length === 0) return [];
      return expandNagashi(betType, axis, 0, picked).map((s) => parseSelection(betType, s));
    } catch {
      return [];
    }
  }, [betType, isSingle, mode, ordered, picked, axis, formation]);

  /** いま選んでいる買い目（正規形）。オッズ表の強調に使う。 */
  const currentSelections = useMemo(
    () => selections.map((picks) => normalizeSelection(betType, picks)),
    [selections, betType],
  );

  /**
   * オッズ表を「1着（順不同なら最小の艇番）ごとの列」に組み替える。
   * 公式サイトのオッズ表と同じ並びになるようにしている。
   */
  const oddsGroups = useMemo(() => {
    const sep = betType.selectionKind === 'combo_unordered' ? '=' : '-';
    const map = new Map<string, { sel: string; rest: string; o: number }[]>();

    for (const [sel, o] of Object.entries(odds)) {
      const parts = sel.split(/[-=]/);
      const head = parts[0]!;
      if (!map.has(head)) map.set(head, []);
      map.get(head)!.push({ sel, rest: parts.slice(1).join(sep), o });
    }

    return [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [odds, betType]);

  /** オッズ表をタップしたら、その買い目をそのまま選択する */
  const pickSelection = (sel: string) => {
    setMessage(null);
    setMode('normal');
    setPicked([]);
    setAxis(null);
    setOrdered(parseSelection(betType, sel));
  };

  const total = selections.length * stake;
  const overBalance = total > balance;
  // お題レースは1人あたりの上限がある
  const overFeature = featureRemain !== undefined && total > featureRemain;

  /** 選んだ買い目が的中したときの払戻の幅 */
  const payoutRange = useMemo(() => {
    const values = selections
      .map((picks) => odds[normalizeSelection(betType, picks)])
      .filter((v): v is number => typeof v === 'number')
      .map((o) => Math.floor(estimatePayout(stake, o) * (featureMultiplier ?? 1)));
    if (values.length === 0) return null;
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [selections, odds, stake, betType]);

  const canSubmit = selections.length > 0 && !overBalance && !overFeature && !pending;

  const submit = () => {
    setMessage(null);
    const fd = new FormData();
    fd.set('marketId', market.id);
    fd.set('betTypeCode', betTypeCode);
    fd.set('stake', String(stake));
    fd.set('selections', JSON.stringify(selections));

    startTransition(async () => {
      const res = await placeBets(fd);
      if (res.ok) {
        setMessage({
          ok: true,
          text: `${res.placed}点を投票しました。${settleWaitingText}。`,
        });
        reset();
      } else {
        setMessage({ ok: false, text: res.error });
      }
    });
  };

  // 通常買いでの艇タップ
  const tapOrdered = (lane: string) => {
    setMessage(null);
    if (isSingle) {
      setOrdered(ordered[0] === lane ? [] : [lane]);
      return;
    }
    if (ordered.includes(lane)) {
      setOrdered(ordered.filter((l) => l !== lane));
      return;
    }
    if (ordered.length >= betType.pickCount) return;
    setOrdered([...ordered, lane]);
  };

  const togglePicked = (lane: string) => {
    setMessage(null);
    setPicked(picked.includes(lane) ? picked.filter((l) => l !== lane) : [...picked, lane]);
  };

  return (
    <section className="mt-2">
      <h2
        className={`flex items-center justify-between border-y px-4 py-2 text-xs font-bold ${
          featureMultiplier
            ? 'border-violet-200 bg-violet-50 text-violet-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}
      >
        <span>投票する</span>
        {featureMultiplier && (
          <span className="tabnum font-bold">
            払戻 ×{featureMultiplier}
            {featureRemain !== undefined && (
              <span className="ml-2 font-normal">あと {fmtPt(featureRemain)}</span>
            )}
          </span>
        )}
      </h2>

      {/* 賭け式 */}
      <div className="flex gap-1 overflow-x-auto px-4 py-3">
        {available.map((bt) => (
          <button
            key={bt.code}
            onClick={() => switchBetType(bt.code)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
              bt.code === betTypeCode ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-sub'
            }`}
          >
            {bt.shortName}
          </button>
        ))}
      </div>

      <p className="px-4 pb-2 text-[11px] text-sub">
        {betType.description}
        {!isSingle && `（全${combinationCount(betType, lanes.length)}通り）`}
      </p>

      {/* 買い方 */}
      {!isSingle && (
        <div className="flex gap-1 px-4 pb-3">
          {(
            [
              { key: 'normal', label: '通常' },
              { key: 'formation', label: 'フォーメーション' },
              { key: 'box', label: 'ボックス' },
              { key: 'nagashi', label: '1着ながし' },
            ] as const
          )
            .filter((m) => !(m.key === 'nagashi' && betType.selectionKind === 'combo_unordered'))
            .map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setMode(m.key);
                  reset();
                }}
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                  mode === m.key ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-sub'
                }`}
              >
                {m.label}
              </button>
            ))}
        </div>
      )}

      {/* 艇の選択 */}
      <div className="px-4">
        {mode === 'nagashi' && !isSingle && (
          <>
            <div className="mb-1 text-[11px] font-bold text-sub">軸（1着）</div>
            <LaneRow
              lanes={lanes}
              selected={axis ? [axis] : []}
              onTap={(l) => setAxis(axis === l ? null : l)}
            />
            <div className="mb-1 mt-3 text-[11px] font-bold text-sub">相手</div>
            <LaneRow
              lanes={lanes.filter((l) => l !== axis)}
              selected={picked}
              onTap={togglePicked}
            />
          </>
        )}

        {mode === 'formation' && !isSingle && (
          <>
            {Array.from({ length: betType.pickCount }).map((_, i) => (
              <div key={i} className={i > 0 ? 'mt-3' : ''}>
                <div className="mb-1 text-[11px] font-bold text-sub">
                  {betType.selectionKind === 'combo_ordered'
                    ? `${i + 1}着の候補`
                    : `${i + 1}つ目の候補`}
                </div>
                <LaneRow
                  lanes={lanes}
                  selected={formation[i] ?? []}
                  onTap={(l) => {
                    setMessage(null);
                    setFormation((prev) => {
                      const next = prev.map((g) => [...g]);
                      const g = next[i] ?? [];
                      next[i] = g.includes(l) ? g.filter((x) => x !== l) : [...g, l];
                      return next;
                    });
                  }}
                />
              </div>
            ))}
            <p className="mt-2 text-[11px] text-sub">
              着ごとに候補を選ぶと、その組み合わせを全部まとめて買えます。
              同じ艇が重なる組み合わせは自動で除かれます。
            </p>
          </>
        )}

        {mode === 'box' && (
          <>
            <div className="mb-1 text-[11px] font-bold text-sub">
              艇を{betType.pickCount}つ以上選ぶ
            </div>
            <LaneRow lanes={lanes} selected={picked} onTap={togglePicked} />
          </>
        )}

        {mode === 'normal' && (
          <>
            <div className="mb-1 text-[11px] font-bold text-sub">
              {isSingle
                ? '艇を選ぶ'
                : `${betType.selectionKind === 'combo_ordered' ? '着順どおりに' : ''}${
                    betType.pickCount
                  }つ選ぶ`}
            </div>
            <LaneRow
              lanes={lanes}
              selected={ordered}
              order={betType.selectionKind === 'combo_ordered' ? ordered : undefined}
              onTap={tapOrdered}
            />
          </>
        )}
      </div>

      {/* オッズ表。選ぶ前から見られるようにしている。
          タップするとその買い目がそのまま選択される。 */}
      <section className="mt-4">
        <div className="mb-1.5 flex items-center justify-between gap-2 px-4">
          <span className="text-[11px] font-bold text-sub">
            オッズ
            <span className="ml-2 font-normal">
              {oddsLoading
                ? '取得中…'
                : oddsUpdatedAt
                  ? `公式 ${oddsUpdatedAt} 時点`
                  : oddsCheckedAt
                    ? `${fmtClock(oddsCheckedAt)} 取得`
                    : ''}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => loadOdds(true)}
              disabled={oddsLoading}
              className="rounded-full border border-line px-3 py-1 text-[11px] font-semibold
                         active:bg-gray-50 disabled:opacity-40"
            >
              {oddsLoading ? '更新中…' : '↻ 更新'}
            </button>
            {officialOddsUrl && (
              <a
                href={officialOddsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-semibold text-sub underline"
              >
                公式 ↗
              </a>
            )}
          </span>
        </div>

        {Object.keys(odds).length === 0 ? (
          <div className="px-4">
            <p className="text-[11px] text-sub">
              {oddsLoading
                ? 'オッズを取得しています…'
                : 'オッズを表示できませんでした（投票はできます）'}
            </p>
            {!oddsLoading && officialOddsUrl && (
              <a
                href={officialOddsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block rounded-xl border border-ink bg-white py-2.5 text-center
                           text-sm font-bold"
              >
                公式サイトでオッズを見る ↗
              </a>
            )}
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">
              オッズを見てから、この画面に戻って投票してください。
              {oddsError && <> （{oddsError}）</>}
            </p>
          </div>
        ) : isSingle ? (
          <div className="grid grid-cols-3 gap-1.5 px-4">
            {lanes.map((lane) => (
              <button
                key={lane}
                onClick={() => pickSelection(lane)}
                className={`flex items-center justify-between rounded-lg border px-2 py-1.5
                            ${
                              ordered[0] === lane
                                ? 'border-ink bg-amber-50'
                                : 'border-line'
                            }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${laneClass(
                    lane,
                  )}`}
                >
                  {lane}
                </span>
                <span className="tabnum text-sm font-bold">
                  {odds[lane] ? odds[lane].toFixed(1) : '—'}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-1">
            <div className="flex min-w-max gap-1.5">
              {oddsGroups.map(([head, items]) => (
                <div key={head} className="w-[86px] shrink-0">
                  <div
                    className={`mb-1 rounded py-0.5 text-center text-xs font-bold ${laneClass(
                      head,
                    )}`}
                  >
                    {head}
                  </div>
                  <ul className="divide-y divide-line/60 overflow-hidden rounded border border-line">
                    {items.map((it) => {
                      const on = currentSelections.includes(it.sel);
                      return (
                        <li key={it.sel}>
                          <button
                            onClick={() => pickSelection(it.sel)}
                            className={`flex w-full items-center justify-between px-1.5 py-1
                                        text-[11px] ${on ? 'bg-amber-100 font-bold' : ''}`}
                          >
                            <span className="tabnum text-sub">{it.rest}</span>
                            <span
                              className={`tabnum font-semibold ${
                                it.o >= 100 ? 'text-red-600' : ''
                              }`}
                            >
                              {it.o.toFixed(1)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 買い目プレビュー（オッズつき） */}
      {selections.length > 0 && (
        <div className="mt-3 px-4">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] font-bold text-sub">
              買い目 {selections.length}点
            </span>
            {oddsUpdatedAt && (
              <span className="text-[10px] text-sub">オッズ {oddsUpdatedAt} 時点</span>
            )}
          </div>

          <ul className="divide-y divide-line/60 rounded-lg border border-line">
            {selections.slice(0, 20).map((picks, i) => {
              const sel = normalizeSelection(betType, picks);
              const o = odds[sel];
              return (
                <li key={i} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="tabnum flex-1 text-sm font-bold">{sel}</span>
                  <span className="tabnum w-16 text-right text-sm">
                    {o ? (
                      <span className={o >= 100 ? 'font-bold text-red-600' : ''}>
                        {o.toFixed(1)}倍
                      </span>
                    ) : (
                      <span className="text-sub">{oddsLoading ? '…' : '—'}</span>
                    )}
                  </span>
                  <span className="tabnum w-20 text-right text-xs text-sub">
                    {o ? `${estimatePayout(stake, o).toLocaleString()}pt` : ''}
                  </span>
                </li>
              );
            })}
          </ul>

          {selections.length > 20 && (
            <p className="mt-1 text-xs text-sub">ほか{selections.length - 20}点</p>
          )}

        </div>
      )}

      {/* 点数 */}
      <div className="mt-4 px-4">
        <div className="mb-1 text-[11px] font-bold text-sub">1点あたりの点数</div>
        <div className="flex gap-1">
          {QUICK_STAKES.map((s) => (
            <button
              key={s}
              onClick={() => setStake(s)}
              className={`flex-1 rounded-lg py-2 text-xs font-bold ${
                stake === s ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-sub'
              }`}
            >
              {s.toLocaleString()}
            </button>
          ))}
        </div>
        <input
          type="number"
          value={stake}
          min={STAKE_UNIT}
          step={STAKE_UNIT}
          onChange={(e) => setStake(Number(e.target.value))}
          className="tabnum mt-2 w-full rounded-lg border border-line px-3 py-2 text-right text-sm"
        />
        <p className="mt-1 text-[11px] text-sub">{STAKE_UNIT}pt単位で入力してください</p>
      </div>

      {/* 確認と実行 */}
      <div className="sticky bottom-16 mt-4 border-t border-line bg-white px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-sub">
            {selections.length}点 × {stake.toLocaleString()}pt
          </span>
          <span className={`tabnum text-lg font-bold ${overBalance ? 'text-red-600' : ''}`}>
            {fmtPt(total)}
          </span>
        </div>

        {/* 的中したらいくらになるか。複数点のときは最小〜最大で示す。 */}
        {payoutRange && (
          <div className="mt-0.5 flex items-baseline justify-between text-xs">
            <span className="text-sub">
              的中したら{featureMultiplier ? `（×${featureMultiplier}込み）` : ''}
            </span>
            <span className="tabnum font-semibold text-red-600">
              {payoutRange.min === payoutRange.max
                ? fmtPt(payoutRange.min)
                : `${payoutRange.min.toLocaleString()} 〜 ${payoutRange.max.toLocaleString()}pt`}
            </span>
          </div>
        )}

        {overBalance && (
          <p className="mt-1 text-xs text-red-600">
            持ちポイントが足りません（残高 {fmtPt(balance)}）
          </p>
        )}

        {overFeature && !overBalance && (
          <p className="mt-1 text-xs text-red-600">
            お題レースはあと {fmtPt(featureRemain!)} まで投票できます
          </p>
        )}

        {message && (
          <p className={`mt-1 text-xs ${message.ok ? 'text-green-700' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-2 w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white
                     shadow-sm active:bg-emerald-700 disabled:bg-gray-300 disabled:shadow-none"
        >
          {pending ? '投票中…' : '投票する'}
        </button>

        <p className="mt-2 text-center text-[10px] leading-relaxed text-sub">
          ポイントに換金性はありません。投票後の取消・変更はできません。
          <br />
          {settleWaitingText}。
        </p>
      </div>
    </section>
  );
}

function LaneRow({
  lanes,
  selected,
  order,
  onTap,
}: {
  lanes: string[];
  selected: string[];
  order?: string[];
  onTap: (lane: string) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {lanes.map((lane) => {
        const on = selected.includes(lane);
        const pos = order ? order.indexOf(lane) : -1;
        return (
          <button
            key={lane}
            onClick={() => onTap(lane)}
            className={`relative aspect-square rounded-lg text-base font-bold transition
                        ${laneClass(lane)}
                        ${on ? 'ring-2 ring-ink ring-offset-1' : 'opacity-60'}`}
          >
            {lane}
            {pos >= 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center
                           rounded-full bg-ink text-[9px] font-bold text-white"
              >
                {pos + 1}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 「13:45 取得」のような表示用 */
function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
