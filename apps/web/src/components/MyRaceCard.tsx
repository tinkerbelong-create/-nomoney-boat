'use client';

/**
 * マイ舟券の1レース分。
 *
 * ふだんは「そのレースで増えたか減ったか」だけを見せ、
 * タップすると買い目が全部開く。みんなの画面と同じ操作感にしている。
 *
 * 結果待ちのレースは最初から開いておく（今なにを買っているか見たいので）。
 */

import { useState } from 'react';
import Link from 'next/link';
import { fmtPt, fmtSigned, fmtDate, fmtTime, profitColor } from '@/lib/format';
import { RefreshResultButton } from '@/components/RefreshResultButton';
import { BOATRACE_BET_TYPES } from '@/core';

export interface MyBet {
  id: string;
  selection: string;
  stake: number;
  status: 'placed' | 'won' | 'lost' | 'refunded';
  payout: number;
  betTypeCode: string;
}

export function MyRaceCard({
  eventId,
  venueName,
  raceNumber,
  deadlineAt,
  bets,
}: {
  eventId?: string;
  venueName: string;
  raceNumber: number;
  deadlineAt: string;
  bets: MyBet[];
}) {
  const done = bets.every((b) => b.status !== 'placed');
  const [open, setOpen] = useState(!done);

  const stake = bets.reduce((s, b) => s + b.stake, 0);
  const payout = bets.reduce((s, b) => s + Number(b.payout), 0);
  const diff = payout - stake;
  const hit = bets.some((b) => b.status === 'won');
  const past = new Date(deadlineAt).getTime() < Date.now();

  return (
    <section className="border-b-8 border-gray-50">
      <button
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 border-b border-line px-4 py-2.5 text-left
                    active:bg-gray-50 ${hit ? 'bg-amber-50' : 'bg-white'}`}
      >
        <StatusChip done={done} hit={hit} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">
            {venueName} {raceNumber}R
          </span>
          <span className="tabnum block text-[11px] text-sub">
            {fmtDate(deadlineAt)} {fmtTime(deadlineAt)} ・ {bets.length}点 {fmtPt(stake)}
          </span>
        </span>

        {done ? (
          <span className={`tabnum shrink-0 text-base font-bold ${profitColor(diff)}`}>
            {fmtSigned(diff)}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-sub">結果待ち</span>
        )}
        <span className="shrink-0 text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {/* 締切を過ぎているのに結果待ちのままなら、その場で取りに行けるようにする */}
      {!done && past && eventId && (
        <div className="px-4 py-2">
          <RefreshResultButton eventId={eventId} />
        </div>
      )}

      {open && (
        <ul>
          {bets.map((b) => {
            const bt = BOATRACE_BET_TYPES.find((x) => x.code === b.betTypeCode);
            const d = b.status === 'placed' ? null : Number(b.payout) - b.stake;

            return (
              <li
                key={b.id}
                className={`flex items-center gap-2 border-b border-line px-4 py-2.5 ${
                  b.status === 'won' ? 'bg-amber-50' : ''
                }`}
              >
                <span className="w-12 shrink-0 rounded bg-gray-100 px-1 py-0.5 text-center text-[10px] font-semibold text-sub">
                  {bt?.shortName}
                </span>
                <span
                  className={`tabnum flex-1 text-base font-bold tracking-wide ${
                    b.status === 'won' ? 'text-red-600' : ''
                  }`}
                >
                  {b.selection}
                </span>
                <span className="tabnum text-[11px] text-sub">{fmtPt(b.stake)}</span>

                <span className="w-20 shrink-0 text-right">
                  {b.status === 'placed' && (
                    <span className="text-[11px] text-sub">結果待ち</span>
                  )}
                  {b.status === 'won' && (
                    <>
                      <div className="tabnum text-sm font-bold text-red-600">
                        {fmtPt(Number(b.payout))}
                      </div>
                      <div className={`tabnum text-[10px] ${profitColor(d!)}`}>
                        {fmtSigned(d!)}
                      </div>
                    </>
                  )}
                  {b.status === 'lost' && <span className="text-[11px] text-gray-400">外れ</span>}
                  {b.status === 'refunded' && (
                    <span className="text-[11px] text-gray-400">返還</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {eventId && (
        <div className="px-4 py-2">
          <Link
            href={`/races/${eventId}`}
            className="text-[11px] font-semibold text-sub underline"
          >
            このレースを見る →
          </Link>
        </div>
      )}
    </section>
  );
}

function StatusChip({ done, hit }: { done: boolean; hit: boolean }) {
  if (!done) {
    return (
      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
        結果待ち
      </span>
    );
  }
  if (hit) {
    return (
      <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
        的中
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
      外れ
    </span>
  );
}
