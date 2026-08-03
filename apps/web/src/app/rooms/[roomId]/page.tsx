/**
 * 部屋の中。
 *   ランキング / タイムライン / トーク / メンバー
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { AutoRefresh } from '@/components/AutoRefresh';
import { TimelineRace, type TimelineRaceData } from '@/components/TimelineRace';
import { MessageForm, LeaveRoomButton } from '@/components/RoomForms';
import { ShareInvite } from '@/components/ShareInvite';
import {
  requireProfile,
  getBalance,
  getRoom,
  getRoomRanking,
  getRoomTimeline,
  getRoomMessages,
  getRoomMembers,
  getRoomTitles,
  currentSeasonCode,
} from '@/lib/queries';
import { fmtSigned, fmtPct, fmtDate, fmtTime, profitColor } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'rank', label: 'ランキング' },
  { key: 'feed', label: 'タイムライン' },
  { key: 'talk', label: 'トーク' },
  { key: 'members', label: 'メンバー' },
] as const;

const TITLE_LABEL: Record<string, string> = {
  champion: '王者',
  hit: '的中王',
  roi: '回収王',
  loser: '大敗王',
};

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ t?: string; m?: string; p?: string }>;
}) {
  const { roomId } = await params;
  const sp = await searchParams;
  const tab = (TABS.find((x) => x.key === sp.t)?.key ?? 'rank') as (typeof TABS)[number]['key'];
  const metric = (['profit', 'roi', 'hit'].includes(sp.m ?? '') ? sp.m : 'profit') as
    | 'profit'
    | 'roi'
    | 'hit';
  const lifetime = sp.p === 'all';

  const profile = await requireProfile();
  const [balance, room] = await Promise.all([getBalance(profile.id), getRoom(roomId)]);
  if (!room) notFound();

  const [ranking, rows, messages, members, titles] = await Promise.all([
    tab === 'rank'
      ? getRoomRanking(roomId, metric, lifetime ? null : currentSeasonCode())
      : [],
    tab === 'feed' ? getRoomTimeline(roomId) : [],
    tab === 'talk' ? getRoomMessages(roomId) : [],
    tab === 'members' || tab === 'rank' ? getRoomMembers(roomId) : [],
    getRoomTitles(roomId),
  ]);

  // タイムラインをレースごとにまとめる
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

  const qs = (t: string, extra = '') => `/rooms/${roomId}?t=${t}${extra}`;

  return (
    <>
      <Header title={room.name} balance={balance} back="/rooms" />
      {tab === 'talk' && <AutoRefresh intervalMs={20_000} />}

      <main className="pb-tab">
        <div className="border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-sub">招待コード</span>
            <span className="tabnum rounded bg-gray-100 px-2 py-0.5 text-base font-bold tracking-widest">
              {room.invite_code}
            </span>
            <span className="ml-auto text-[11px] text-sub">{room.member_count}人</span>
          </div>
        </div>

        <div className="grid grid-cols-4 border-b border-line">
          {TABS.map((x) => (
            <Link
              key={x.key}
              href={qs(x.key)}
              className={`py-2.5 text-center text-xs font-semibold ${
                x.key === tab ? 'border-b-2 border-ink text-ink' : 'text-sub'
              }`}
            >
              {x.label}
            </Link>
          ))}
        </div>

        {/* ---------------- ランキング ---------------- */}
        {tab === 'rank' && (
          <>
            <div className="flex gap-2 px-4 pt-3">
              {[
                { key: 'month', label: '今月' },
                { key: 'all', label: '通算' },
              ].map((p) => (
                <Link
                  key={p.key}
                  href={qs('rank', `&m=${metric}${p.key === 'all' ? '&p=all' : ''}`)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    (p.key === 'all') === lifetime ? 'bg-ink text-white' : 'bg-gray-100 text-sub'
                  }`}
                >
                  {p.label}
                </Link>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1 px-4">
              {[
                { key: 'profit', label: '収支' },
                { key: 'roi', label: '回収率' },
                { key: 'hit', label: '的中率' },
              ].map((m) => (
                <Link
                  key={m.key}
                  href={qs('rank', `&m=${m.key}${lifetime ? '&p=all' : ''}`)}
                  className={`rounded-lg py-2 text-center text-sm font-semibold ${
                    m.key === metric ? 'bg-ink text-white' : 'bg-gray-100 text-sub'
                  }`}
                >
                  {m.label}
                </Link>
              ))}
            </div>

            <ol className="mt-3">
              {(ranking as any[]).map((r, i) => (
                <li
                  key={r.user_id}
                  className={`flex items-center gap-3 border-b border-line px-4 py-3 ${
                    r.is_me ? 'bg-amber-50' : ''
                  }`}
                >
                  <span className="tabnum w-6 text-center text-sm font-bold text-sub">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={r.is_me ? '/me' : `/u/${r.handle}`}
                      className="truncate text-sm font-semibold underline-offset-2 hover:underline"
                    >
                      {r.display_name}
                      {r.is_me && (
                        <span className="ml-1 text-[10px] text-amber-700">あなた</span>
                      )}
                    </Link>
                    <div className="text-[11px] text-sub">
                      {r.race_count}レース {r.race_hit_count}的中
                    </div>
                  </div>
                  <div className="tabnum text-right">
                    <div
                      className={`text-base font-bold ${
                        metric === 'profit' ? profitColor(Number(r.profit)) : ''
                      }`}
                    >
                      {metric === 'profit'
                        ? fmtSigned(Number(r.profit))
                        : metric === 'roi'
                          ? fmtPct(r.roi_pct)
                          : fmtPct(r.hit_pct)}
                    </div>
                    <div className="text-[10px] text-sub">
                      {metric === 'profit'
                        ? `回収 ${fmtPct(r.roi_pct)}`
                        : `収支 ${fmtSigned(Number(r.profit))}`}
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            {titles.length > 0 && (
              <section className="border-t-8 border-gray-50">
                <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
                  この部屋の月間タイトル
                </h2>
                <ul className="divide-y divide-line">
                  {(titles as any[]).map((t) => (
                    <li
                      key={`${t.season_code}-${t.kind}`}
                      className="flex items-center gap-2 px-4 py-2.5"
                    >
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          t.kind === 'champion'
                            ? 'bg-violet-100 text-violet-900'
                            : t.kind === 'loser'
                              ? 'bg-gray-200 text-gray-700'
                              : 'bg-yellow-100 text-yellow-900'
                        }`}
                      >
                        {t.kind === 'champion' ? '👑' : '★'}
                      </span>
                      <span className="text-sm font-bold">
                        {label(t.season_code)}の{TITLE_LABEL[t.kind]}
                      </span>
                      <Link
                        href={`/u/${t.profiles.handle}`}
                        className="ml-auto truncate text-sm font-semibold underline-offset-2 hover:underline"
                      >
                        {t.profiles.display_name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {/* ---------------- タイムライン ---------------- */}
        {tab === 'feed' &&
          ([...races.values()].length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-sub">
              締切を過ぎた投票が、ここにレースごとに並びます。
            </p>
          ) : (
            [...races.values()].map((race) => (
              <TimelineRace key={race.event_id} race={race} myUserId={profile.id} />
            ))
          ))}

        {/* ---------------- トーク ---------------- */}
        {tab === 'talk' && (
          <>
            <ul className="px-4 py-3">
              {(messages as any[]).length === 0 && (
                <li className="py-10 text-center text-sm text-sub">
                  まだメッセージがありません。
                  <br />
                  「今日のお題どうする？」から始めてみてください。
                </li>
              )}
              {(messages as any[]).map((msg) => {
                const mine = msg.user_id === profile.id;
                return (
                  <li
                    key={msg.id}
                    className={`mb-2 flex ${mine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] ${mine ? 'text-right' : ''}`}>
                      {!mine && (
                        <div className="mb-0.5 text-[10px] text-sub">
                          {msg.profiles.display_name}
                        </div>
                      )}
                      <div
                        className={`inline-block whitespace-pre-wrap rounded-2xl px-3 py-2 text-left text-sm ${
                          mine ? 'bg-emerald-600 text-white' : 'bg-gray-100'
                        }`}
                      >
                        {msg.body}
                      </div>
                      <div className="tabnum mt-0.5 text-[10px] text-sub">
                        {fmtDate(msg.created_at)} {fmtTime(msg.created_at)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <MessageForm roomId={roomId} />
          </>
        )}

        {/* ---------------- メンバー ---------------- */}
        {tab === 'members' && (
          <>
            <ul className="divide-y divide-line">
              {(members as any[]).map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-bold">
                    {m.profiles.display_name.slice(0, 1)}
                  </span>
                  <Link
                    href={m.user_id === profile.id ? '/me' : `/u/${m.profiles.handle}`}
                    className="min-w-0 flex-1"
                  >
                    <div className="truncate text-sm font-semibold">
                      {m.profiles.display_name}
                    </div>
                    <div className="truncate text-[11px] text-sub">@{m.profiles.handle}</div>
                  </Link>
                  {m.role === 'owner' && (
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-sub">
                      作成者
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <section className="border-t-8 border-gray-50 px-4 py-4">
              <h2 className="mb-2 text-[11px] font-bold text-sub">この部屋に招待する</h2>
              <ShareInvite url={`招待コード ${room.invite_code}`} handle={room.invite_code} />
            </section>

            {!room.is_owner && (
              <div className="px-4 pb-6">
                <LeaveRoomButton roomId={roomId} />
              </div>
            )}
          </>
        )}
      </main>

      <TabBar />
    </>
  );
}

/** '2026-08' → '2026年8月' */
function label(seasonCode: string): string {
  const [y, m] = seasonCode.split('-');
  return `${y}年${Number(m)}月`;
}
