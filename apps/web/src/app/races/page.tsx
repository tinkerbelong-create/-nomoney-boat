/**
 * レース画面。
 *
 * 公式アプリのトップに合わせて3つの見方を用意している。
 *   開催一覧 … 場ごとのカード。次のレースと締切時刻が出る
 *   締切順   … 全場をまたいで締切が近い順
 *   お気に入り … お気に入り選手が出るレースだけ
 */

import Link from 'next/link';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { Countdown } from '@/components/Countdown';
import { AutoRefresh } from '@/components/AutoRefresh';
import {
  requireProfile,
  getBalance,
  getRacesForDate,
  getFavoriteEventMap,
} from '@/lib/queries';
import { fmtTime } from '@/lib/format';
import { settleDelayText } from '@/lib/settings';

export const dynamic = 'force-dynamic';

function ymd(offsetDays = 0): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86_400_000);
  return jst.toISOString().slice(0, 10).replace(/-/g, '');
}

type View = 'venue' | 'time' | 'fav';

const VIEWS: { key: View; label: string }[] = [
  { key: 'venue', label: '開催一覧' },
  { key: 'time', label: '締切順' },
  { key: 'fav', label: 'お気に入り' },
];

export default async function RacesPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; v?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.d ?? ymd(0);
  const view = (VIEWS.find((v) => v.key === sp.v)?.key ?? 'venue') as View;

  const profile = await requireProfile();

  const [balance, races] = await Promise.all([
    getBalance(profile.id),
    getRacesForDate(date),
  ]);

  const favMap = await getFavoriteEventMap(races.map((r: any) => r.id));

  const now = Date.now();
  const isOpen = (r: any) =>
    r.status === 'scheduled' && new Date(r.deadline_at).getTime() > now;

  const serverNow = Date.now();

  return (
    <>
      <Header title="レース" balance={balance} />
      <AutoRefresh intervalMs={30_000} />

      <main className="pb-tab">
        {/* 日付 */}
        <div className="flex gap-2 px-4 pt-3">
          {[
            { d: ymd(0), label: '今日' },
            { d: ymd(1), label: '明日' },
          ].map((t) => (
            <Link
              key={t.d}
              href={`/races?d=${t.d}&v=${view}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                t.d === date ? 'bg-ink text-white' : 'bg-gray-100 text-sub'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* 見方の切り替え */}
        <div className="mt-3 grid grid-cols-3 border-b border-line">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/races?d=${date}&v=${v.key}`}
              className={`py-2.5 text-center text-sm font-semibold ${
                v.key === view
                  ? 'border-b-2 border-ink text-ink'
                  : 'text-sub'
              }`}
            >
              {v.label}
            </Link>
          ))}
        </div>

        {races.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-sub">
            この日の開催情報はまだ取り込まれていません。
          </div>
        ) : view === 'venue' ? (
          <VenueGrid races={races} date={date} favMap={favMap} now={now} />
        ) : view === 'fav' ? (
          <FavoriteList
            races={races.filter((r: any) => favMap.has(r.id))}
            favMap={favMap}
            serverNow={serverNow}
            isOpen={isOpen}
          />
        ) : (
          <TimeList races={races} favMap={favMap} serverNow={serverNow} isOpen={isOpen} />
        )}
      </main>

      <TabBar />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 開催一覧（場ごとのカード）                                          */
/* ------------------------------------------------------------------ */

function VenueGrid({
  races,
  date,
  favMap,
  now,
}: {
  races: any[];
  date: string;
  favMap: Map<string, string[]>;
  now: number;
}) {
  // 場ごとにまとめる
  const byVenue = new Map<string, any[]>();
  for (const r of races) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code)!.push(r);
  }

  const cards = [...byVenue.entries()]
    .map(([code, list]) => {
      const sorted = [...list].sort((a, b) => a.race_number - b.race_number);
      // 次に締め切るレース。すべて締切済みなら最終レース。
      const next =
        sorted.find(
          (r) => r.status === 'scheduled' && new Date(r.deadline_at).getTime() > now,
        ) ?? sorted[sorted.length - 1];
      return {
        code,
        name: sorted[0].venue_name,
        title: sorted[0].title,
        grade: sorted[0].grade as string | null,
        next,
        finished: !sorted.some(
          (r) => r.status === 'scheduled' && new Date(r.deadline_at).getTime() > now,
        ),
        hasFav: sorted.some((r) => favMap.has(r.id)),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {cards.map((c) => (
        <Link
          key={c.code}
          href={`/races/venue/${c.code}?d=${date}`}
          className={`rounded-xl border p-3 active:bg-gray-50 ${
            c.finished ? 'border-line bg-gray-50' : 'border-ink/15 bg-white'
          }`}
        >
          <div className="flex items-center gap-1">
            <span
              className={`truncate text-base font-bold ${
                c.finished ? 'text-sub' : 'text-ink'
              }`}
            >
              {c.name}
            </span>
            {c.hasFav && <span className="text-amber-500">★</span>}
          </div>

          <div className="mt-1 flex items-center gap-1">
            {c.grade && (
              <span className="rounded bg-ink px-1 py-px text-[10px] font-bold text-white">
                {c.grade}
              </span>
            )}
            <span className="truncate text-[10px] text-sub">{c.title}</span>
          </div>

          <div className="tabnum mt-2">
            {c.finished ? (
              <span className="text-xs text-sub">本日終了</span>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-bold">{c.next.race_number}R</span>
                  <span className="text-sm font-bold text-red-600">
                    {fmtTime(c.next.deadline_at)}
                  </span>
                </div>
                <Countdown deadline={c.next.deadline_at} serverNow={now} />
              </>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 締切順                                                              */
/* ------------------------------------------------------------------ */

function TimeList({
  races,
  favMap,
  serverNow,
  isOpen,
}: {
  races: any[];
  favMap: Map<string, string[]>;
  serverNow: number;
  isOpen: (r: any) => boolean;
}) {
  const upcoming = races.filter(isOpen);
  const done = races.filter((r) => !isOpen(r));

  return (
    <>
      {upcoming.length > 0 && (
        <section>
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            投票できるレース
          </h2>
          <ul>
            {upcoming.map((r) => (
              <RaceRow
                key={r.id}
                race={r}
                serverNow={serverNow}
                open
                fav={favMap.get(r.id)}
              />
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
              <RaceRow
                key={r.id}
                race={r}
                serverNow={serverNow}
                open={false}
                fav={favMap.get(r.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* お気に入り                                                          */
/* ------------------------------------------------------------------ */

function FavoriteList({
  races,
  favMap,
  serverNow,
  isOpen,
}: {
  races: any[];
  favMap: Map<string, string[]>;
  serverNow: number;
  isOpen: (r: any) => boolean;
}) {
  if (races.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-3xl">★</p>
        <p className="mt-3 text-sm font-semibold">
          お気に入り選手の出走はありません
        </p>
        <p className="mt-1 text-xs leading-relaxed text-sub">
          選手を登録すると、その選手が出るレースがここに並びます。
        </p>
        <Link
          href="/me/favorites"
          className="mt-5 inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white"
        >
          お気に入り選手を登録する
        </Link>
      </div>
    );
  }

  return (
    <ul>
      {races.map((r) => (
        <RaceRow
          key={r.id}
          race={r}
          serverNow={serverNow}
          open={isOpen(r)}
          fav={favMap.get(r.id)}
        />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

function RaceRow({
  race,
  serverNow,
  open,
  fav,
}: {
  race: any;
  serverNow: number;
  open: boolean;
  fav?: string[];
}) {
  return (
    <li>
      <Link
        href={`/races/${race.id}`}
        className={`flex items-center gap-3 border-b border-line px-4 py-3 active:bg-gray-50
                    ${open ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-transparent'}`}
      >
        <div className="w-14 shrink-0">
          <div className="flex items-center gap-0.5">
            <span className="text-sm font-bold">{race.venue_name}</span>
            {fav && fav.length > 0 && <span className="text-amber-500">★</span>}
          </div>
          <div className="tabnum text-[11px] text-sub">{race.race_number}R</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-sub">{race.title}</div>
          {fav && fav.length > 0 ? (
            <div className="truncate text-[11px] font-semibold text-amber-700">
              {fav.join('・')}
            </div>
          ) : (
            race.grade && (
              <span className="mt-0.5 inline-block rounded bg-ink px-1.5 py-px text-[10px] font-bold text-white">
                {race.grade}
              </span>
            )
          )}
        </div>

        <div className="shrink-0 text-right">
          <div className="tabnum text-sm font-bold">{fmtTime(race.deadline_at)}</div>
          {open ? (
            <Countdown deadline={race.deadline_at} serverNow={serverNow} />
          ) : (
            <div className="mt-0.5">
              <RaceStatus status={race.status} />
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

/** レースの状態を色つきの札で示す */
function RaceStatus({ status }: { status: string }) {
  if (status === 'cancelled') {
    return <Chip className="bg-gray-200 text-gray-700">中止</Chip>;
  }
  if (status === 'resolved') {
    return <Chip className="bg-blue-100 text-blue-800">確定</Chip>;
  }
  return <Chip className="bg-amber-100 text-amber-900">結果待ち</Chip>;
}

function Chip({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${className}`}>
      {children}
    </span>
  );
}
