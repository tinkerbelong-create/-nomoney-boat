/**
 * 大会の一覧。
 *
 * 参加費ぶんの大会ポイントを全員が同じだけ持って始める。
 * 持ちポイントの多さではなく、増やし方のうまさで競う。
 */

import Link from 'next/link';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { CreateTournamentForm, JoinTournamentForm } from '@/components/TournamentForms';
import { requireProfile, getBalance, getMyTournaments } from '@/lib/queries';
import { fmtPt, fmtSigned, fmtDate, fmtTime, profitColor } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: '募集中', cls: 'bg-emerald-100 text-emerald-800' },
  running: { label: '開催中', cls: 'bg-amber-100 text-amber-900' },
  finished: { label: '終了', cls: 'bg-blue-100 text-blue-800' },
  cancelled: { label: '中止', cls: 'bg-gray-200 text-gray-700' },
};

export default async function TournamentsPage() {
  const profile = await requireProfile();
  const [balance, list] = await Promise.all([getBalance(profile.id), getMyTournaments()]);

  return (
    <>
      <Header title="大会" balance={balance} />

      <main className="pb-tab">
        {list.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-4xl">🏆</p>
            <p className="mt-3 text-sm font-semibold">まだ大会がありません</p>
            <p className="mt-1 text-xs leading-relaxed text-sub">
              大会を作って招待コードを送るか、
              <br />
              もらったコードで参加してください。
            </p>
          </div>
        ) : (
          <ul>
            {list.map((t) => {
              const st = STATUS[t.status] ?? STATUS.open;
              const diff = t.my_points - t.entry_fee;
              return (
                <li key={t.id}>
                  <Link
                    href={`/tournaments/${t.id}`}
                    className="block border-b border-line px-4 py-3.5 active:bg-gray-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${st.cls}`}>
                        {st.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">{t.name}</span>
                      {t.joined && t.status !== 'open' && (
                        <span className={`tabnum shrink-0 text-sm font-bold ${profitColor(diff)}`}>
                          {fmtSigned(diff)}
                        </span>
                      )}
                    </div>
                    <div className="tabnum mt-1 text-[11px] text-sub">
                      参加費 {fmtPt(t.entry_fee)} ・ {t.member_count}人 ・{' '}
                      {t.scope === 'selected' ? `${t.race_count}レース` : '期間中の全レース'}
                    </div>
                    <div className="tabnum text-[11px] text-sub">
                      {fmtDate(t.starts_at)} {fmtTime(t.starts_at)} 〜 {fmtDate(t.ends_at)}{' '}
                      {fmtTime(t.ends_at)}
                    </div>
                    {/* 景品があるなら一覧でも見せる。参加する理由になる。 */}
                    {t.prize_1 && (
                      <div className="mt-1 truncate text-[11px] font-semibold text-amber-800">
                        🎁 優勝 {t.prize_1}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <section className="border-t-8 border-gray-50 px-4 py-4">
          <h2 className="mb-2 text-[11px] font-bold text-sub">招待コードで参加する</h2>
          <JoinTournamentForm />
        </section>

        <section className="border-t-8 border-gray-50 px-4 py-4">
          <h2 className="mb-3 text-[11px] font-bold text-sub">大会を作る</h2>
          <CreateTournamentForm balance={balance} />
        </section>

        <section className="border-t border-line px-4 py-4">
          <h2 className="mb-2 text-[11px] font-bold text-sub">大会のルール</h2>
          <ul className="list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-sub">
            <li>参加すると、持ちポイントから参加費が引かれ、同じ額が大会ポイントになります。</li>
            <li>全員が同じ額から始まるので、持ちポイントの多さは関係ありません。</li>
            <li>大会の対象レースは大会ポイントで、それ以外は今までどおり持ちポイントで買えます。</li>
            <li>大会ポイントが0になったらそこで終了です。追加はできません。</li>
            <li>始まったあとの参加はできません。</li>
            <li>終わると、残った大会ポイントがそのまま持ちポイントに戻ります。</li>
            <li>
              主催者は景品を決められます。景品は主催者が自分で用意するもので、サイトは表示するだけです。
              現金・ギフト券など換金できるものは景品にできません。
            </li>
          </ul>
        </section>
      </main>

      <TabBar />
    </>
  );
}
