/**
 * みんな。
 *
 * レースごとにまとめて、誰がいくら増えた／減ったかを並べる。
 * タップすると全員の買い目が開く。
 *
 * 締切前の投票は出てこない（真似を防ぐため、締切後にだけ見える）。
 */

import Link from 'next/link';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { AutoRefresh } from '@/components/AutoRefresh';
import { TimelineRace, type TimelineRaceData } from '@/components/TimelineRace';
import { requireProfile, getBalance, getTimeline } from '@/lib/queries';
import { fmtSigned, profitColor } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
  const profile = await requireProfile();
  const [balance, rows] = await Promise.all([getBalance(profile.id), getTimeline(300)]);

  // レースごとにまとめる（新しい順は元の並びを保つ）
  const races = new Map<string, TimelineRaceData>();
  for (const r of rows as any[]) {
    if (!races.has(r.event_id)) {
      races.set(r.event_id, {
        event_id: r.event_id,
        venue_name: r.venue_name,
        race_number: r.race_number,
        deadline_at: r.deadline_at,
        event_status: r.event_status,
        bets: [],
      });
    }
    races.get(r.event_id)!.bets.push({
      bet_id: r.bet_id,
      user_id: r.user_id,
      handle: r.handle,
      display_name: r.display_name,
      bet_type_code: r.bet_type_code,
      selection: r.selection,
      stake: r.stake,
      status: r.status,
      payout: Number(r.payout),
    });
  }

  const list = [...races.values()];

  // みんなの合計（確定したぶんだけ）
  const totalDiff = list
    .flatMap((r) => r.bets)
    .filter((b) => b.status === 'won' || b.status === 'lost')
    .reduce((s, b) => s + (Number(b.payout) - b.stake), 0);

  const waiting = list.some((r) => r.bets.some((b) => b.status === 'placed'));

  return (
    <>
      <Header title="みんな" balance={balance} />
      {waiting && <AutoRefresh intervalMs={30_000} />}

      <main className="pb-tab">
        {list.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-3xl">📣</p>
            <p className="mt-3 text-sm font-semibold">まだ投票がありません</p>
            <p className="mt-1 text-xs leading-relaxed text-sub">
              締切を過ぎた投票が、ここにレースごとに並びます。
            </p>
            <Link
              href="/invite"
              className="mt-5 inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white"
            >
              友達を招待する
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
              <span className="text-[11px] font-bold text-sub">
                みんなの合計（確定ぶん）
              </span>
              <span className={`tabnum text-lg font-bold ${profitColor(totalDiff)}`}>
                {fmtSigned(totalDiff)}
              </span>
            </div>

            <p className="px-4 py-2 text-[10px] leading-relaxed text-sub">
              締切を過ぎた投票だけが見えます。レースをタップすると全員の買い目が開きます。
            </p>

            {list.map((race) => (
              <TimelineRace key={race.event_id} race={race} myUserId={profile.id} />
            ))}
          </>
        )}
      </main>

      <TabBar />
    </>
  );
}
