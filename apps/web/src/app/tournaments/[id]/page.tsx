/**
 * 大会の中。
 *   順位 / 対象レース / アナウンス
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { AutoRefresh } from '@/components/AutoRefresh';
import { AnnouncementForm, RaceToggle, PrizeForm } from '@/components/TournamentForms';
import { Countdown } from '@/components/Countdown';
import {
  requireProfile,
  getBalance,
  getTournament,
  getTournamentRanking,
  getTournamentRaces,
  getTournamentPledge,
  getRacesForDate,
} from '@/lib/queries';
import { fmtPt, fmtSigned, fmtDate, fmtTime, profitColor } from '@/lib/format';

export const dynamic = 'force-dynamic';

function ymd(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

export default async function TournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const profile = await requireProfile();
  const [balance, t] = await Promise.all([getBalance(profile.id), getTournament(id)]);
  if (!t) notFound();

  const [ranking, races, pledge] = await Promise.all([
    getTournamentRanking(id),
    getTournamentRaces(id),
    getTournamentPledge(id),
  ]);

  // 作成者が開始前にレースを選ぶための候補
  const canEdit = t.is_owner && t.status === 'open' && t.scope === 'selected';
  const pickDate = sp.d ?? ymd(new Date(t.starts_at));
  const candidates = canEdit ? await getRacesForDate(pickDate) : [];
  const chosen = new Set((races as any[]).map((r) => r.event_id));

  const serverNow = Date.now();
  const running = t.status === 'running';

  // 景品。書かれていない順位は飛ばす。
  const prizes = [t.prize_1, t.prize_2, t.prize_3];
  const hasPrize = prizes.some((p) => p.length > 0);
  // 終わったあとは、順位表と突き合わせて「誰が何をもらうか」を出す
  const winners = (ranking as any[]).slice(0, 3);

  return (
    <>
      <Header title={t.name} balance={balance} back="/tournaments" />
      {running && <AutoRefresh intervalMs={30_000} />}

      <main className="pb-tab">
        {/* 見出し */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <span className="rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">
              {t.status === 'open'
                ? '募集中'
                : t.status === 'running'
                  ? '開催中'
                  : t.status === 'finished'
                    ? '終了'
                    : '中止'}
            </span>
            <span className="tabnum text-[11px]">招待コード</span>
            <span className="tabnum rounded bg-white/25 px-2 py-0.5 text-sm font-bold tracking-widest">
              {t.invite_code}
            </span>
          </div>
          <div className="tabnum mt-1.5 text-[11px] text-white/90">
            参加費 {fmtPt(t.entry_fee)} ・ {t.member_count}人 ・{' '}
            {t.scope === 'selected' ? `対象 ${t.race_count}レース` : '期間中の全レース'}
          </div>
          <div className="tabnum text-[11px] text-white/90">
            {fmtDate(t.starts_at)} {fmtTime(t.starts_at)} 〜 {fmtDate(t.ends_at)}{' '}
            {fmtTime(t.ends_at)}
          </div>
        </div>

        {/* 自分の大会ポイント */}
        {t.joined && (
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="flex-1">
              <div className="text-[11px] text-sub">あなたの大会ポイント</div>
              <div className="tabnum text-2xl font-bold">{fmtPt(t.my_points)}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-sub">増減</div>
              <div
                className={`tabnum text-lg font-bold ${profitColor(
                  t.my_points - t.entry_fee,
                )}`}
              >
                {fmtSigned(t.my_points - t.entry_fee)}
              </div>
            </div>
          </div>
        )}

        {!t.joined && (
          <div className="border-b border-line bg-amber-50 px-4 py-3 text-[11px] leading-relaxed text-amber-900">
            あなたはまだ参加していません。
            {t.status === 'open'
              ? '大会一覧から招待コードで参加してください。'
              : 'すでに始まっているので参加できません。'}
          </div>
        )}

        {/* 景品。参加する理由になるので、順位表より先に出す。 */}
        {(hasPrize || (t.is_owner && t.status !== 'finished' && t.status !== 'cancelled')) && (
          <section className="border-b-8 border-gray-50">
            <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">🎁 景品</h2>

            {hasPrize && (
              <ul className="divide-y divide-line">
                {prizes.map((prize, i) =>
                  prize ? (
                    <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                                    text-xs font-bold ${
                                      i === 0
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : i === 1
                                          ? 'bg-slate-100 text-slate-700'
                                          : 'bg-amber-100 text-amber-800'
                                    }`}
                      >
                        {i + 1}位
                      </span>
                      <span className="min-w-0 flex-1 break-words text-sm font-semibold">
                        {prize}
                      </span>
                      {/* 終わっていれば、その順位の人を出す */}
                      {t.status === 'finished' && winners[i] && (
                        <span className="shrink-0 text-[11px] font-bold text-sub">
                          → {winners[i].display_name}
                        </span>
                      )}
                    </li>
                  ) : null,
                )}
              </ul>
            )}

            {/* 主催者の誓約。参加を決める人がこれを読めることに意味がある。 */}
            {hasPrize && pledge && (
              <div className="mx-4 my-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                <div className="text-[11px] font-bold text-amber-900">主催者の誓約</div>
                <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-amber-900">
                  {pledge.pledgeText}
                </p>
                <div className="mt-2 border-t border-amber-200 pt-2 text-[11px] font-bold text-amber-900">
                  {pledge.displayName} が同意
                  <span className="tabnum ml-1 font-normal">
                    （{fmtDate(pledge.agreedAt)} {fmtTime(pledge.agreedAt)}）
                  </span>
                </div>
              </div>
            )}

            <p className="px-4 py-2.5 text-[10px] leading-relaxed text-sub">
              景品は主催者が全額を負担します。サイトは表示するだけで、
              用意にも受け渡しにも関わりません。
            </p>

            {t.is_owner && t.status !== 'finished' && t.status !== 'cancelled' && (
              <div className="border-t border-line px-4 py-3">
                <PrizeForm
                  tournamentId={t.id}
                  initial={[t.prize_1, t.prize_2, t.prize_3]}
                />
              </div>
            )}
          </section>
        )}

        {/* アナウンス */}
        <section className="border-b-8 border-gray-50">
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            アナウンス
          </h2>
          <div className="px-4 py-3">
            {t.is_owner ? (
              <AnnouncementForm tournamentId={t.id} initial={t.announcement} />
            ) : t.announcement ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.announcement}</p>
            ) : (
              <p className="text-xs text-sub">まだありません。</p>
            )}
          </div>
        </section>

        {/* 順位 */}
        <section className="border-b-8 border-gray-50">
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            順位（増やした額）
          </h2>
          {(ranking as any[]).length === 0 ? (
            <p className="px-4 py-4 text-xs text-sub">まだ参加者がいません。</p>
          ) : (
            <ol>
              {(ranking as any[]).map((r, i) => (
                <li
                  key={r.user_id}
                  className={`flex items-center gap-3 border-b border-line px-4 py-3 ${
                    r.is_me ? 'bg-amber-50' : ''
                  }`}
                >
                  <span className="tabnum w-6 shrink-0 text-center text-sm font-bold text-sub">
                    {i + 1}
                    {/* 景品のある順位には目印。狙う気持ちが出るように。 */}
                    {prizes[i] && <span className="block text-[10px]">🎁</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={r.is_me ? '/me' : `/u/${r.handle}`}
                      className="truncate text-sm font-semibold"
                    >
                      {r.display_name}
                      {r.is_me && (
                        <span className="ml-1 text-[10px] text-amber-700">あなた</span>
                      )}
                    </Link>
                    <div className="tabnum text-[11px] text-sub">
                      {r.bet_count}点 {r.hit_count}的中
                      {r.is_out && (
                        <span className="ml-1 font-bold text-gray-500">・脱落</span>
                      )}
                    </div>
                  </div>
                  <div className="tabnum text-right">
                    <div className={`text-base font-bold ${profitColor(Number(r.diff))}`}>
                      {fmtSigned(Number(r.diff))}
                    </div>
                    <div className="text-[10px] text-sub">{fmtPt(Number(r.points))}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* 対象レース */}
        <section className="border-b-8 border-gray-50">
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            {t.scope === 'selected' ? '対象レース' : '対象：期間中の全レース'}
          </h2>

          {t.scope === 'all' ? (
            <p className="px-4 py-3 text-xs leading-relaxed text-sub">
              期間中のどのレースでも、大会ポイントで投票できます。
              <br />
              レース画面で「大会ポイントで買う」を選んでください。
            </p>
          ) : (races as any[]).length === 0 ? (
            <p className="px-4 py-3 text-xs text-sub">
              まだ対象レースがありません。
              {t.is_owner && '下から選んでください。'}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {(races as any[]).map((r) => {
                const open =
                  r.status === 'scheduled' &&
                  new Date(r.deadline_at).getTime() > serverNow;
                return (
                  <li key={r.event_id}>
                    <Link
                      href={`/races/${r.event_id}`}
                      className="flex items-center gap-3 px-4 py-2.5 active:bg-gray-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">
                          {r.venue_name} {r.race_number}R
                        </span>
                        <span className="tabnum block text-[11px] text-sub">
                          {fmtDate(r.deadline_at)} {fmtTime(r.deadline_at)}
                        </span>
                      </span>
                      {open ? (
                        <Countdown deadline={r.deadline_at} serverNow={serverNow} />
                      ) : (
                        <span className="text-[11px] text-sub">
                          {r.status === 'resolved' ? '確定' : '締切'}
                        </span>
                      )}
                      {canEdit && (
                        <RaceToggle tournamentId={t.id} eventId={r.event_id} on />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 作成者だけ：対象レースを選ぶ */}
        {canEdit && (
          <section>
            <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
              対象レースを選ぶ（開始前だけ）
            </h2>
            <div className="flex gap-2 px-4 py-2">
              {[0, 1, 2].map((n) => {
                const d = new Date(new Date(t.starts_at).getTime() + n * 86_400_000);
                const key = ymd(d);
                return (
                  <Link
                    key={key}
                    href={`/tournaments/${t.id}?d=${key}`}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      key === pickDate ? 'bg-ink text-white' : 'bg-gray-100 text-sub'
                    }`}
                  >
                    {fmtDate(d.toISOString())}
                  </Link>
                );
              })}
            </div>
            <ul className="divide-y divide-line">
              {(candidates as any[]).map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {r.venue_name} {r.race_number}R
                    </span>
                    <span className="tabnum block text-[11px] text-sub">
                      {fmtTime(r.deadline_at)}
                    </span>
                  </span>
                  <RaceToggle
                    tournamentId={t.id}
                    eventId={r.id}
                    on={chosen.has(r.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-sub">
          終了すると、残った大会ポイントがそのまま持ちポイントに戻ります。
          <br />
          ポイントに換金性はありません。
        </p>
      </main>

      <TabBar />
    </>
  );
}
