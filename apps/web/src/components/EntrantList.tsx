'use client';

/**
 * 出走表。
 *
 * 名前と級別はデータベースにあるものをそのまま出し、
 * 勝率・当地・モーターといった細かい数字は開いたときに取りに行って足す。
 * 取れないうちは「公式で見る」への案内を出す。
 */

import { useEffect, useState } from 'react';
import { laneClass } from '@/lib/format';
import { FavoriteButton } from '@/components/FavoriteButton';

interface Entrant {
  slot_code: string;
  name: string;
  meta: Record<string, any> | null;
}

export function EntrantList({
  eventId,
  entrants,
  favorites,
  racelistUrl,
}: {
  eventId: string;
  entrants: Entrant[];
  favorites: string[];
  racelistUrl?: string;
}) {
  const [extra, setExtra] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const needsDetail = entrants.some((e) => !e.meta?.nationalWin);

  useEffect(() => {
    if (!needsDetail) return;
    let cancelled = false;
    setLoading(true);

    fetch(`/api/racelist/${eventId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const map: Record<string, any> = {};
        for (const e of d.entrants ?? []) map[e.slotCode] = e.meta;
        setExtra(map);
        if ((d.entrants ?? []).length === 0) setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [eventId, needsDetail]);

  const favSet = new Set(favorites);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <ul>
        {entrants.map((e) => {
          const m = { ...(e.meta ?? {}), ...(extra[e.slot_code] ?? {}) };
          const rates: string[] = Array.isArray(m.rates) ? m.rates : [];
          const win = m.nationalWin ?? rates[0];
          const top2 = m.nationalTop2 ?? rates[1];
          const detailOpen = open === e.slot_code;

          return (
            <li key={e.slot_code} className="border-b border-line">
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm font-bold ${laneClass(
                    e.slot_code,
                  )}`}
                >
                  {e.slot_code}
                </span>

                <button
                  onClick={() => setOpen(detailOpen ? null : e.slot_code)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-semibold">{e.name}</div>
                  <div className="tabnum truncate text-[11px] text-sub">
                    {m.racerClass && (
                      <span className="mr-1.5 rounded bg-gray-100 px-1 font-bold">
                        {m.racerClass}
                      </span>
                    )}
                    {m.branch && <span className="mr-1.5">{m.branch}</span>}
                    {m.age && <span className="mr-1.5">{m.age}歳</span>}
                    {m.racerId && <span className="text-gray-400">#{m.racerId}</span>}
                  </div>
                </button>

                <button
                  onClick={() => setOpen(detailOpen ? null : e.slot_code)}
                  className="shrink-0 text-right"
                >
                  <div className="tabnum text-base font-bold leading-tight">
                    {win ?? (loading ? '…' : '—')}
                  </div>
                  <div className="text-[10px] leading-tight text-sub">勝率</div>
                  <div className="tabnum mt-0.5 text-sm font-semibold leading-tight">
                    {top2 ? `${Math.round(Number(top2))}%` : loading ? '…' : '—'}
                  </div>
                  <div className="text-[10px] leading-tight text-sub">2連率</div>
                </button>

                {m.racerId && (
                  <FavoriteButton
                    racerId={m.racerId}
                    name={e.name}
                    initialOn={favSet.has(m.racerId)}
                    size="sm"
                  />
                )}
              </div>

              {detailOpen && (
                <div className="bg-gray-50 px-4 py-2.5">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <Row label="全国 勝率" value={m.nationalWin} />
                    <Row label="全国 2連率" value={pct(m.nationalTop2)} />
                    <Row label="当地 勝率" value={m.localWin} />
                    <Row label="当地 2連率" value={pct(m.localTop2)} />
                    <Row label="平均ST" value={m.avgSt} />
                    <Row label="体重" value={m.weight ? `${m.weight}kg` : undefined} />
                    <Row
                      label={`モーター${m.motorNo ? ` #${m.motorNo}` : ''}`}
                      value={pct(m.motorTop2)}
                    />
                    <Row
                      label={`ボート${m.boatNo ? ` #${m.boatNo}` : ''}`}
                      value={pct(m.boatTop2)}
                    />
                  </div>

                  {racelistUrl && (
                    <a
                      href={racelistUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-[11px] font-semibold text-sub underline"
                    >
                      今節成績・展示など、もっと詳しく（公式サイト）↗
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {failed && racelistUrl && (
        <div className="px-4 py-2.5">
          <p className="text-[11px] text-sub">
            細かい成績を取得できませんでした。公式サイトでご覧ください。
          </p>
          <a
            href={racelistUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block rounded-full border border-line px-4 py-1.5 text-xs font-semibold"
          >
            公式サイトの出走表を開く ↗
          </a>
        </div>
      )}
    </>
  );
}

function pct(v: unknown): string | undefined {
  return v ? `${v}%` : undefined;
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-sub">{label}</span>
      <span className="tabnum font-semibold">{value ?? '—'}</span>
    </div>
  );
}
