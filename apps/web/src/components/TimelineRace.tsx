'use client';

/**
 * みんなの画面の1レース分。
 *
 * ふだんは「誰がいくら増えた／減った」だけを見せ、
 * タップすると全員の買い目が開く。
 */

import { useState } from 'react';
import Link from 'next/link';
import { fmtPt, fmtSigned, fmtTime, profitColor } from '@/lib/format';
import { BOATRACE_BET_TYPES } from '@/core';

export interface TimelineBet {
  bet_id: string;
  user_id: string;
  handle: string;
  display_name: string;
  bet_type_code: string;
  selection: string;
  stake: number;
  status: 'placed' | 'won' | 'lost' | 'refunded';
  payout: number;
}

export interface TimelineRaceData {
  event_id: string;
  venue_name: string;
  race_number: number;
  deadline_at: string;
  event_status: string;
  bets: TimelineBet[];
}

export function TimelineRace({
  race,
  myUserId,
}: {
  race: TimelineRaceData;
  myUserId: string;
}) {
  const [open, setOpen] = useState(false);

  // 人ごとにまとめる
  const byUser = new Map<
    string,
    { name: string; handle: string; stake: number; payout: number; bets: TimelineBet[] }
  >();
  for (const b of race.bets) {
    if (!byUser.has(b.user_id)) {
      byUser.set(b.user_id, {
        name: b.display_name,
        handle: b.handle,
        stake: 0,
        payout: 0,
        bets: [],
      });
    }
    const u = byUser.get(b.user_id)!;
    u.stake += b.stake;
    u.payout += Number(b.payout);
    u.bets.push(b);
  }

  const users = [...byUser.entries()]
    .map(([id, u]) => ({ id, ...u, diff: u.payout - u.stake }))
    .sort((a, b) => b.diff - a.diff);

  const settled = race.bets.every((b) => b.status !== 'placed');
  const totalDiff = users.reduce((s, u) => s + u.diff, 0);

  return (
    <section className="border-b-8 border-gray-50">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 border-b border-line bg-white px-4 py-2.5 text-left active:bg-gray-50"
      >
        <StatusBadge settled={settled} status={race.event_status} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">
            {race.venue_name} {race.race_number}R
          </span>
          <span className="tabnum block text-[11px] text-sub">
            {fmtTime(race.deadline_at)} 締切 ・ {users.length}人が投票
          </span>
        </span>

        {settled && (
          <span className={`tabnum shrink-0 text-sm font-bold ${profitColor(totalDiff)}`}>
            {fmtSigned(totalDiff)}
          </span>
        )}
        <span className="shrink-0 text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      <ul>
        {users.map((u) => {
          const isMe = u.id === myUserId;
          return (
            <li key={u.id} className={isMe ? 'bg-amber-50' : ''}>
              <div className="flex items-center gap-2 border-b border-line/60 px-4 py-2">
                <Link
                  href={isMe ? '/me' : `/u/${u.handle}`}
                  className="min-w-0 flex-1 truncate text-sm font-semibold"
                >
                  {u.name}
                  {isMe && (
                    <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] text-amber-900">
                      あなた
                    </span>
                  )}
                </Link>

                <span className="tabnum shrink-0 text-[11px] text-sub">
                  {u.bets.length}点 {fmtPt(u.stake)}
                </span>

                {settled ? (
                  <span
                    className={`tabnum w-20 shrink-0 text-right text-sm font-bold ${profitColor(
                      u.diff,
                    )}`}
                  >
                    {fmtSigned(u.diff)}
                  </span>
                ) : (
                  <span className="w-20 shrink-0 text-right text-[11px] text-sub">
                    結果待ち
                  </span>
                )}
              </div>

              {open && (
                <ul className="bg-gray-50 px-4 py-1.5">
                  {u.bets.map((b) => {
                    const bt = BOATRACE_BET_TYPES.find((x) => x.code === b.bet_type_code);
                    return (
                      <li
                        key={b.bet_id}
                        className="flex items-center gap-2 py-0.5 text-[11px]"
                      >
                        <span className="w-10 shrink-0 text-sub">{bt?.shortName}</span>
                        <span
                          className={`tabnum flex-1 font-bold ${
                            b.status === 'won' ? 'text-red-600' : ''
                          }`}
                        >
                          {b.selection}
                        </span>
                        <span className="tabnum text-sub">{fmtPt(b.stake)}</span>
                        <span className="w-16 shrink-0 text-right">
                          {b.status === 'won' && (
                            <span className="tabnum font-bold text-red-600">
                              {fmtPt(Number(b.payout))}
                            </span>
                          )}
                          {b.status === 'lost' && <span className="text-gray-400">外れ</span>}
                          {b.status === 'refunded' && (
                            <span className="text-gray-400">返還</span>
                          )}
                          {b.status === 'placed' && (
                            <span className="text-gray-400">待ち</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className="px-4 py-2">
        <Link
          href={`/races/${race.event_id}`}
          className="text-[11px] font-semibold text-sub underline"
        >
          このレースを見る →
        </Link>
      </div>
    </section>
  );
}

/** レースの状態を色で示す */
function StatusBadge({ settled, status }: { settled: boolean; status: string }) {
  if (status === 'cancelled') {
    return <Chip className="bg-gray-200 text-gray-700">中止</Chip>;
  }
  if (settled || status === 'resolved') {
    return <Chip className="bg-blue-100 text-blue-800">確定</Chip>;
  }
  return <Chip className="bg-amber-100 text-amber-900">結果待ち</Chip>;
}

function Chip({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${className}`}
    >
      {children}
    </span>
  );
}
