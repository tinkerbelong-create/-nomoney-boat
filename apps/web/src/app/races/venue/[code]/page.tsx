/**
 * レース・結果一覧（1つの場の当日12レース）。
 * 公式アプリの「レース・結果一覧」にあたる画面。
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { Countdown } from '@/components/Countdown';
import { AutoRefresh } from '@/components/AutoRefresh';
import {
  requireProfile,
  getBalance,
  getVenueRaces,
  getFavoriteEventMap,
} from '@/lib/queries';
import { fmtTime, laneClass } from '@/lib/format';

export const dynamic = 'force-dynamic';

function ymd(offsetDays = 0): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86_400_000);
  return jst.toISOString().slice(0, 10).replace(/-/g, '');
}

export default async function VenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { code } = await params;
  const date = (await searchParams).d ?? ymd(0);

  const profile = await requireProfile();
  const [balance, races] = await Promise.all([
    getBalance(profile.id),
    getVenueRaces(date, code),
  ]);

  if (races.length === 0) notFound();

  const favMap = await getFavoriteEventMap(races.map((r: any) => r.id));
  const serverNow = Date.now();
  const head = races[0] as any;

  return (
    <>
      <Header title={head.venue_name} balance={balance} back="/races" />
      <AutoRefresh intervalMs={30_000} />

      <main className="pb-tab">
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center gap-1.5">
            {head.grade && (
              <span className="rounded bg-ink px-1.5 py-px text-[10px] font-bold text-white">
                {head.grade}
              </span>
            )}
            <span className="truncate text-sm font-bold">{head.title}</span>
          </div>

          <a
            href={`https://www.boatrace.jp/owpc/pc/race/raceindex?jcd=${code}&hd=${date}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block rounded-full border border-line px-3 py-1 text-xs font-semibold text-sub"
          >
            公式サイトで出走表・映像を見る ↗
          </a>
        </div>

        <ul>
          {races.map((r: any) => {
            const open =
              r.status === 'scheduled' &&
              new Date(r.deadline_at).getTime() > serverNow;

            const result = Array.isArray(r.event_results)
              ? r.event_results[0]
              : r.event_results;
            const placings: any[] = result?.placings ?? [];
            const top3 = placings
              .filter((p) => p.rank >= 1 && p.rank <= 3)
              .sort((a, b) => a.rank - b.rank);

            // 3連単の払戻（100ptあたり）
            const tri = (r.markets ?? []).find(
              (m: any) => m.bet_type_code === 'trifecta',
            );
            const triResult = (tri?.market_results ?? [])[0];

            const fav = favMap.get(r.id);

            return (
              <li key={r.id}>
                <Link
                  href={`/races/${r.id}`}
                  className={`flex items-start gap-3 border-b border-line border-l-4 px-4 py-3
                              active:bg-gray-50 ${
                                r.status === 'cancelled'
                                  ? 'border-l-gray-300 bg-gray-50'
                                  : open
                                    ? 'border-l-emerald-500'
                                    : top3.length > 0
                                      ? 'border-l-blue-400'
                                      : 'border-l-amber-400 bg-amber-50/40'
                              }`}
                >
                  <div className="w-10 shrink-0">
                    <div className="tabnum text-base font-bold">{r.race_number}R</div>
                    <div className="tabnum text-[11px] text-sub">
                      {fmtTime(r.deadline_at)}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    {fav && fav.length > 0 && (
                      <div className="truncate text-[11px] font-semibold text-amber-700">
                        ★ {fav.join('・')}
                      </div>
                    )}

                    {top3.length > 0 ? (
                      <div className="flex items-center gap-1">
                        <Chip className="mr-1 bg-blue-100 text-blue-800">確定</Chip>
                        {top3.map((p, i) => (
                          <span key={p.rank} className="flex items-center gap-1">
                            {i > 0 && <span className="text-[10px] text-sub">-</span>}
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${laneClass(
                                p.slot,
                              )}`}
                            >
                              {p.slot}
                            </span>
                          </span>
                        ))}
                        {result?.decided_by && (
                          <span className="ml-1 text-[11px] text-sub">
                            {result.decided_by}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div>
                        {r.status === 'cancelled' ? (
                          <Chip className="bg-gray-200 text-gray-700">中止（全額返還）</Chip>
                        ) : open ? (
                          <Chip className="bg-emerald-100 text-emerald-800">投票受付中</Chip>
                        ) : (
                          <Chip className="bg-amber-100 text-amber-900">結果を集計中</Chip>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    {triResult ? (
                      <>
                        <div className="text-[10px] text-sub">3連単</div>
                        <div className="tabnum text-sm font-bold">
                          {Number(triResult.payout_per_100).toLocaleString()}
                        </div>
                        {triResult.popularity && (
                          <div className="text-[10px] text-sub">
                            {triResult.popularity}番人気
                          </div>
                        )}
                      </>
                    ) : open ? (
                      <Countdown deadline={r.deadline_at} serverNow={serverNow} />
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-sub">
          払戻は100ptあたりのポイントです。現金との交換はできません。
          <br />
          レース映像は公式サイト・アプリでご覧ください。
        </p>
      </main>

      <TabBar />
    </>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${className}`}>
      {children}
    </span>
  );
}
