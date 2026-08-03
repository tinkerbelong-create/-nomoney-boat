/**
 * 部屋の一覧。
 *
 * LINEのグループのようなもの。招待コードを送って入ってもらう。
 * ポイントは1人1つの残高を共用していて、部屋は「誰と比べるか」だけを変える。
 */

import Link from 'next/link';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { CreateRoomForm, JoinRoomForm } from '@/components/RoomForms';
import { requireProfile, getBalance, getMyRooms } from '@/lib/queries';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function RoomsPage() {
  const profile = await requireProfile();
  const [balance, rooms] = await Promise.all([getBalance(profile.id), getMyRooms()]);

  return (
    <>
      <Header title="部屋" balance={balance} />

      <main className="pb-tab">
        {rooms.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-4xl">🏠</p>
            <p className="mt-3 text-sm font-semibold">まだ部屋がありません</p>
            <p className="mt-1 text-xs leading-relaxed text-sub">
              部屋を作って招待コードを送るか、
              <br />
              もらったコードで入ってください。
            </p>
          </div>
        ) : (
          <ul>
            {rooms.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/rooms/${r.id}`}
                  className="flex items-center gap-3 border-b border-line px-4 py-3.5 active:bg-gray-50"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg">
                    🏠
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{r.name}</div>
                    <div className="truncate text-[11px] text-sub">
                      {r.last_message ?? `${r.member_count}人`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabnum text-[10px] text-sub">
                      {r.last_at ? fmtDate(r.last_at) : ''}
                    </div>
                    <div className="tabnum text-[11px] font-semibold text-sub">
                      {r.member_count}人
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section className="border-t-8 border-gray-50 px-4 py-4">
          <h2 className="mb-2 text-[11px] font-bold text-sub">招待コードで入る</h2>
          <JoinRoomForm />
        </section>

        <section className="border-t border-line px-4 py-4">
          <h2 className="mb-2 text-[11px] font-bold text-sub">部屋を作る</h2>
          <CreateRoomForm />
          <p className="mt-2 text-[11px] leading-relaxed text-sub">
            作ると6文字の招待コードが出ます。それを友達に送れば入ってもらえます。
          </p>
        </section>

        <section className="border-t border-line px-4 py-4">
          <h2 className="mb-2 text-[11px] font-bold text-sub">部屋とフレンドの違い</h2>
          <ul className="list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-sub">
            <li>ポイントは1人1つ。どの部屋にいても同じ残高で勝負します。</li>
            <li>部屋は「誰と比べるか」を変えるだけ。いくつ入っても大丈夫です。</li>
            <li>部屋の中ではメッセージが送れます。</li>
            <li>フレンドは今までどおり。ホームの「全フレンド」で比べられます。</li>
          </ul>
        </section>
      </main>

      <TabBar />
    </>
  );
}
