/**
 * レース一覧。締切が近い順に並べる。
 */

import Link from 'next/link';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { Countdown } from '@/components/Countdown';
import { AutoRefresh } from '@/components/AutoRefresh';
import { requireProfile, getBalance, getRacesForDate } from '@/lib/queries';
import { fmtTime } from '@/lib/format';
import { settleDelayText } from '@/lib/settings';

export const dynamic = 'force-dynamic';

function ymd(offsetDays = 0): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86_400_000);
  return jst.toISOString().slice(0, 10).replace(/-/g, '');
}

export default async function RacesPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.d ?? ymd(0);

  const profile = await requireProfile();

  const [balance, races] = await Promise.all([getBalance(profile.id), getRacesForDate(date)]);

  // 締切前を上に、締切済みを下に
  const now = Date.now();
  const upcoming = races.filter(
    (r) => r.status === 'scheduled' && new Date(r.deadline_at).getTime() > now,
  );
  const done = races.filter(
    (r) => !(r.status === 'scheduled' && new Date(r.deadline_at).getTime() > now),
  );

  // サーバ時刻をクライアントに渡す。端末の時計を信用しないため。
  const serverNow = Date.now();

  return (
    <>
      <Header title="レース" balance={balance} />
      <AutoRefresh intervalMs={30_000} />

      <main className="pb-tab">
        <div className="flex gap-2 border-b border-line px-4 py-3">
          {[
            { d: ymd(0), label: '今日' },
            { d: ymd(1), label: '明日' },
          ].map((t) => (
            <Link
              key={t.d}
              href={`/races?d=${t.d}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                t.d === date ? 'bg-ink text-white' : 'bg-gray-100 text-sub'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {races.length === 0 && (
          <div className="px-6 py-16 text-center text-sm text-sub">
            この日の開催情報はまだ取り込まれていません。
          </div>
        )}

        {upcoming.length > 0 && (
          <section>
            <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
              投票できるレース
            </h2>
            <ul>
              {upcoming.map((r) => (
                <RaceRow key={r.id} race={r} serverNow={serverNow} open />
              ))}
            </ul>
          </section>
        )}

        {done.length > 0 && (
          <section>
            <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
              締切済み
              <span className="ml-2 font-normal">{settleDelayText}</span>
            </h2>
            <ul>
              {done.map((r) => (
                <RaceRow key={r.id} race={r} serverNow={serverNow} open={false} />
              ))}
            </ul>
          </section>
        )}
      </main>

      <TabBar />
    </>
  );
}

function RaceRow({
  race,
  serverNow,
  open,
}: {
  race: any;
  serverNow: number;
  open: boolean;
}) {
  return (
    <li>
      <Link
        href={`/races/${race.id}`}
        className="flex items-center gap-3 border-b border-line px-4 py-3 active:bg-gray-50"
      >
        <div className="w-14 shrink-0">
          <div className="text-sm font-bold">{race.venue_name}</div>
          <div className="tabnum text-[11px] text-sub">{race.race_number}R</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-sub">{race.title}</div>
          {race.grade && (
            <span className="mt-0.5 inline-block rounded bg-ink px-1.5 py-px text-[10px] font-bold text-white">
              {race.grade}
            </span>
          )}
        </div>

        <div className="shrink-0 text-right">
          <div className="tabnum text-sm font-bold">{fmtTime(race.deadline_at)}</div>
          {race.status === 'cancelled' ? (
            <div className="text-[11px] font-semibold text-sub">中止</div>
          ) : open ? (
            <Countdown deadline={race.deadline_at} serverNow={serverNow} />
          ) : (
            <div className="text-[11px] text-sub">
              {race.status === 'resolved' ? '結果あり' : '締切'}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
