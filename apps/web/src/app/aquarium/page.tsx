/**
 * 水槽。
 *
 * ポイントの出口。当てると海の生き物が1体もらえる。
 * 買えないし売れないし譲れない。称号と同じ「実績の記録」でしかない。
 *
 * 上に動く水槽（30体まで）、下に図鑑（324体・未取得も出す）。
 * 未取得をシルエットで見せているのは称号と同じ考え方で、
 * 「見えているから狙いにいける」ようにするため。
 */

import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { Tank } from '@/components/Tank';
import { Creature } from '@/components/Creature';
import { requireProfile, getBalance, getCreatureBook, getTank } from '@/lib/queries';
import { STAR_LABEL, whereText } from '@/lib/aquarium';

export const dynamic = 'force-dynamic';

export default async function AquariumPage() {
  const profile = await requireProfile();
  const [balance, tank, book] = await Promise.all([
    getBalance(profile.id),
    getTank(profile.id),
    getCreatureBook(profile.id),
  ]);

  const owned = book.filter((c) => c.count > 0);
  const total = book.length;

  return (
    <>
      <Header title="水槽" balance={balance} />

      <main className="pb-tab">
        <div className="pt-4">
          <Tank items={tank} />
        </div>

        <section className="mt-6 border-t-8 border-gray-50 px-4 pt-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-bold text-sub">図鑑</h2>
            <span className="tabnum text-[11px] text-sub">
              {owned.length} / {total} 種
            </span>
          </div>

          {/* ★ごとに並べる。上にいくほど珍しい */}
          {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((star) => {
            const rows = book.filter((c) => c.star === star);
            if (rows.length === 0) return null;
            const got = rows.filter((c) => c.count > 0).length;
            return (
              <div key={star} className="mt-4">
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="text-xs font-bold">★{star}</span>
                  <span className="text-[10px] text-sub">{STAR_LABEL[star]}</span>
                  <span className="tabnum ml-auto text-[10px] text-sub">
                    {got} / {rows.length}
                  </span>
                </div>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1">
                  {rows.map((c) => {
                    const has = c.count > 0;
                    const where = whereText(c);
                    return (
                      <li
                        key={c.code}
                        title={has ? `${c.name}${where ? `（${where}）` : ''}` : '？'}
                        className={`relative flex aspect-square items-center justify-center
                                    overflow-hidden rounded-lg
                                    ${has ? 'bg-white' : 'bg-gray-100'}`}
                      >
                        {has ? (
                          <>
                            <Creature c={c} scale={0.27} />
                            {c.count > 1 && (
                              <span className="tabnum absolute bottom-0 right-1 text-[9px] text-sub">
                                {c.count}
                              </span>
                            )}
                          </>
                        ) : (
                          // 未取得はシルエット。何かがいることは見せる
                          <div className="opacity-[0.13] grayscale">
                            <Creature c={{ ...c, color_a: '#000', color_b: '#000' }} scale={0.27} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>

        <section className="mt-6 border-t border-line px-4 py-4">
          <h2 className="mb-2 text-[11px] font-bold text-sub">生き物の増やし方</h2>
          <ul className="list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-sub">
            <li>レースを当てると1体もらえます。ポイントは使いません。</li>
            <li>
              <strong className="text-ink">当てた払戻が高いほど、めずらしいものが出ます。</strong>
              1000倍以上を1000pt賭けて当てると、伝説の1体が確定します。
            </li>
            <li>掛け金は1000ptで打ち止め。それ以上賭けても出やすくなりません。</li>
            <li>大きい開催（G3→G2→G1→SG）ほど少し良くなります。小さい当たりほど効きます。</li>
            <li>場によって出るものが変わります。淡水・汽水・海水、地区、そして夜のレース。</li>
            <li>24場それぞれに、その場でしか出ない主がいます。</li>
            <li>生き物は売れません。譲れません。ポイントにも戻せません。記録です。</li>
          </ul>
        </section>
      </main>

      <TabBar />
    </>
  );
}
