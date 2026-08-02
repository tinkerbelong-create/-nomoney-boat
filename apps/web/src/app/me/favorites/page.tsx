/**
 * お気に入り選手（最大10人）。
 *
 * 選手は「出走表に一度でも載ったことのある選手」から探す。
 * 登録した選手が出るレースには、レース一覧で★が付く。
 */

import { Header } from '@/components/Header';
import { FavoriteButton } from '@/components/FavoriteButton';
import {
  requireProfile,
  getBalance,
  getFavoriteRacers,
  searchRacers,
  FAVORITE_LIMIT,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = (await searchParams).q ?? '';

  const profile = await requireProfile();
  const [balance, favorites, results] = await Promise.all([
    getBalance(profile.id),
    getFavoriteRacers(),
    searchRacers(q),
  ]);

  const favSet = new Set(favorites.map((f) => f.racer_id));
  const full = favorites.length >= FAVORITE_LIMIT;

  return (
    <>
      <Header title="お気に入り選手" balance={balance} back="/me" />

      <main className="pb-tab">
        <section className="border-b border-line px-4 py-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-bold text-sub">登録中</h2>
            <span className="tabnum text-[11px] text-sub">
              {favorites.length} / {FAVORITE_LIMIT}人
            </span>
          </div>

          {favorites.length === 0 ? (
            <p className="mt-3 text-xs text-sub">
              まだ登録がありません。下から選手を探してください。
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {favorites.map((f) => (
                <li key={f.racer_id} className="flex items-center gap-3 py-2">
                  <span className="flex-1 truncate text-sm font-semibold">
                    {f.name || `#${f.racer_id}`}
                  </span>
                  <span className="tabnum text-[11px] text-gray-400">#{f.racer_id}</span>
                  <FavoriteButton
                    racerId={f.racer_id}
                    name={f.name}
                    initialOn
                    size="sm"
                  />
                </li>
              ))}
            </ul>
          )}

          {full && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              上限の{FAVORITE_LIMIT}人です。追加するには、どれかを外してください。
            </p>
          )}
        </section>

        <section className="px-4 py-4">
          <h2 className="mb-2 text-[11px] font-bold text-sub">選手を探す</h2>

          <form method="get" className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="選手名 または 登録番号"
              className="flex-1 rounded-lg border border-line px-3 py-2 text-sm"
            />
            <button className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">
              検索
            </button>
          </form>

          {q && results.length === 0 && (
            <p className="mt-4 text-xs text-sub">
              見つかりませんでした。
              <br />
              取り込み済みの出走表に載っている選手だけが対象です。
            </p>
          )}

          <ul className="mt-2 divide-y divide-line">
            {results.map((r) => (
              <li key={r.racer_id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.name}</div>
                  <div className="tabnum text-[11px] text-sub">
                    {r.racer_class && <span className="mr-1.5">{r.racer_class}</span>}
                    <span className="text-gray-400">#{r.racer_id}</span>
                  </div>
                </div>
                <FavoriteButton
                  racerId={r.racer_id}
                  name={r.name}
                  initialOn={favSet.has(r.racer_id)}
                  size="sm"
                />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
