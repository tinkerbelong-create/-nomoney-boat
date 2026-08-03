/**
 * ホーム = ランキング。
 * 要件どおり「自分とフレンドのランキングが最初に目に入る」画面にしている。
 */

import Link from 'next/link';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import {
  requireProfile,
  getBalance,
  getRanking,
  currentSeasonCode,
  getDailyFeature,
} from '@/lib/queries';
import { FeatureBanner } from '@/components/FeatureBanner';
import { fmtSigned, fmtPct, profitColor } from '@/lib/format';

const METRICS = [
  { key: 'profit', label: '収支' },
  { key: 'roi', label: '回収率' },
  { key: 'hit', label: '的中率' },
] as const;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; p?: string }>;
}) {
  const sp = await searchParams;
  const metric = (METRICS.find((x) => x.key === sp.m)?.key ?? 'profit') as
    | 'profit'
    | 'roi'
    | 'hit';
  const lifetime = sp.p === 'all';

  const profile = await requireProfile();

  const [balance, ranking, feature] = await Promise.all([
    getBalance(profile.id),
    getRanking(metric, lifetime ? null : currentSeasonCode()),
    getDailyFeature(),
  ]);

  const qs = (m: string, p: string) => `/?m=${m}${p === 'all' ? '&p=all' : ''}`;

  return (
    <>
      <Header title="ランキング" balance={balance} />

      <main className="pb-tab">
        {feature && <FeatureBanner feature={feature} serverNow={Date.now()} />}

        {/* 期間 */}
        <div className="flex gap-2 px-4 pt-4">
          {[
            { key: 'month', label: '今月' },
            { key: 'all', label: '通算' },
          ].map((p) => (
            <Link
              key={p.key}
              href={qs(metric, p.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                (p.key === 'all') === lifetime
                  ? 'bg-ink text-white'
                  : 'bg-gray-100 text-sub'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>

        {/* 3軸の切り替え */}
        <div className="mt-3 grid grid-cols-3 gap-1 px-4">
          {METRICS.map((m) => (
            <Link
              key={m.key}
              href={qs(m.key, lifetime ? 'all' : 'month')}
              className={`rounded-lg py-2 text-center text-sm font-semibold ${
                m.key === metric ? 'bg-ink text-white' : 'bg-gray-100 text-sub'
              }`}
            >
              {m.label}
            </Link>
          ))}
        </div>

        {ranking.length <= 1 ? (
          <EmptyFriends />
        ) : (
          <ol className="mt-4">
            {ranking.map((r: any, i: number) => (
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
                  <div className="truncate text-sm font-semibold">
                    {r.display_name}
                    {r.is_me && <span className="ml-1 text-[10px] text-amber-700">あなた</span>}
                  </div>
                  <div className="text-[11px] text-sub">
                    {r.race_count ?? 0}レース {r.race_hit_count ?? 0}的中
                    <span className="ml-1 text-gray-400">（{r.bet_count}点）</span>
                  </div>
                </div>

                <div className="tabnum text-right">
                  {metric === 'profit' && (
                    <div className={`text-base font-bold ${profitColor(Number(r.profit))}`}>
                      {fmtSigned(Number(r.profit))}
                    </div>
                  )}
                  {metric === 'roi' && (
                    <div className="text-base font-bold">{fmtPct(r.roi_pct)}</div>
                  )}
                  {metric === 'hit' && (
                    <div className="text-base font-bold">{fmtPct(r.hit_pct)}</div>
                  )}
                  <div className="text-[10px] text-sub">
                    {metric === 'profit'
                      ? `回収 ${fmtPct(r.roi_pct)}`
                      : `収支 ${fmtSigned(Number(r.profit))}`}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-sub">
          このサイトのポイントに換金性はありません。
          <br />
          現金・景品との交換はできません。
        </p>
      </main>

      <TabBar />
    </>
  );
}

function EmptyFriends() {
  return (
    <div className="mt-10 px-6 text-center">
      <p className="text-4xl">👋</p>
      <p className="mt-3 text-sm font-semibold">まだ対戦相手がいません</p>
      <p className="mt-1 text-xs leading-relaxed text-sub">
        フレンドを追加すると、ここに収支ランキングが出ます。
      </p>
      <Link
        href="/friends/search"
        className="mt-5 inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white"
      >
        フレンドを探す
      </Link>
      <div className="mt-3">
        <Link href="/friends/search" className="text-xs font-semibold text-sub underline">
          すでに登録している友達を探す
        </Link>
      </div>
    </div>
  );
}
