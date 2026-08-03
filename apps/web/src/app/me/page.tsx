import Link from 'next/link';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { signOut } from '@/app/actions';
import {
  requireProfile,
  getBalance,
  getMyStats,
  currentSeasonCode,
  getRaceSummary,
  getBadges,
} from '@/lib/queries';
import { fmtSigned, fmtPct, profitColor } from '@/lib/format';
import { summarize } from '@/core';

export const dynamic = 'force-dynamic';

export default async function MePage() {
  const profile = await requireProfile();

  const [balance, stats, races, badges] = await Promise.all([
    getBalance(profile.id),
    getMyStats(profile.id, currentSeasonCode()),
    getRaceSummary(profile.id, currentSeasonCode()),
    getBadges(profile.id),
  ]);
  const earned = badges.filter((b) => b.earned_at);
  const recent = [...earned]
    .sort((a, b) => (b.earned_at! > a.earned_at! ? 1 : -1))
    .slice(0, 6);

  const totals = stats.reduce(
    (acc, s) => ({
      betCount: acc.betCount + s.bet_count,
      hitCount: acc.hitCount + s.hit_count,
      totalStake: acc.totalStake + Number(s.total_stake),
      totalPayout: acc.totalPayout + Number(s.total_payout),
    }),
    { betCount: 0, hitCount: 0, totalStake: 0, totalPayout: 0 },
  );
  const profit = totals.totalPayout - totals.totalStake;
  const roi = totals.totalStake > 0 ? (totals.totalPayout / totals.totalStake) * 100 : null;
  // 的中率は「レース単位」。3連単を20点買って1点当たれば的中1レース。
  const hit =
    races.race_count > 0 ? (races.race_hit_count / races.race_count) * 100 : null;

  const links = [
    { href: '/me/badges', label: '称号', sub: 'コレクション' },
    { href: '/me/stats', label: '成績の詳細', sub: '賭け式別・月次推移' },
    { href: '/me/bets', label: '投票履歴', sub: 'これまでの投票' },
    { href: '/invite', label: '友達を招待', sub: 'URLとユーザーIDを送る' },
    { href: '/me/favorites', label: 'お気に入り選手', sub: '最大10人・出走レースに★' },
    { href: '/friends', label: 'フレンド', sub: '一覧・申請' },
    { href: '/about', label: 'このサイトについて', sub: '換金性について' },
  ];

  return (
    <>
      <Header title="マイページ" balance={balance} />

      <main className="pb-tab">
        <div className="border-b border-line px-4 py-4">
          <div className="text-lg font-bold">{profile.display_name}</div>
          <div className="text-xs text-sub">@{profile.handle}</div>
        </div>

        {/* 今月のサマリ */}
        <section className="border-b border-line px-4 py-4">
          <h2 className="mb-3 text-[11px] font-bold text-sub">
            今月の成績（{currentSeasonCode()}）
          </h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="収支" value={fmtSigned(profit)} className={profitColor(profit)} />
            <Stat label="回収率" value={fmtPct(roi)} />
            <Stat label="的中率" value={fmtPct(hit)} />
          </div>
          <p className="mt-3 text-center text-[11px] text-sub">
            {races.race_count}レース {races.race_hit_count}的中（{totals.betCount}点）
          </p>
        </section>

        {/* 称号。取ったものが並んでいると嬉しいので、一覧より先に出す。 */}
        <section className="border-b border-line px-4 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[11px] font-bold text-sub">称号</h2>
            <Link href="/me/badges" className="text-[11px] font-semibold text-sub underline">
              {earned.length} / {badges.length} を見る
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="text-xs text-sub">
              まだありません。投票して結果が出ると自動で付きます。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {recent.map((b) => (
                <span
                  key={b.code}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                    b.rarity === 'crown'
                      ? 'border-violet-300 bg-violet-50 text-violet-900'
                      : b.rarity === 'gold'
                        ? 'border-yellow-300 bg-yellow-50 text-yellow-900'
                        : b.rarity === 'silver'
                          ? 'border-slate-300 bg-slate-50 text-slate-800'
                          : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  {b.rarity === 'crown' ? '👑 ' : '★ '}
                  {b.name}
                </span>
              ))}
            </div>
          )}
        </section>

        <ul>
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="flex items-center gap-3 border-b border-line px-4 py-3.5 active:bg-gray-50"
              >
                <div className="flex-1">
                  <div className="text-sm font-semibold">{l.label}</div>
                  <div className="text-[11px] text-sub">{l.sub}</div>
                </div>
                <span className="text-sub">›</span>
              </Link>
            </li>
          ))}
        </ul>

        <form action={signOut} className="px-4 py-6">
          <button className="w-full rounded-xl border border-line py-3 text-sm text-sub">
            ログアウト
          </button>
        </form>
      </main>

      <TabBar />
    </>
  );
}

function Stat({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-xl bg-gray-50 py-3">
      <div className="text-[10px] text-sub">{label}</div>
      <div className={`tabnum mt-0.5 text-base font-bold ${className}`}>{value}</div>
    </div>
  );
}
