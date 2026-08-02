import Link from 'next/link';
import { Header } from '@/components/Header';
import { FriendActions } from '@/components/FriendActions';
import { requireProfile, getBalance, getFriends } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function FriendsPage() {
  const profile = await requireProfile();

  const [balance, friends] = await Promise.all([getBalance(profile.id), getFriends()]);

  return (
    <>
      <Header title="フレンド" balance={balance} back="/me" />

      <main className="pb-tab">
        <div className="px-4 py-3">
          <Link
            href="/friends/search"
            className="block w-full rounded-xl bg-ink py-3 text-center text-sm font-bold text-white"
          >
            フレンドを探す
          </Link>
        </div>

        {friends.incoming.length > 0 && (
          <section>
            <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
              承認待ち（{friends.incoming.length}件）
            </h2>
            <ul>
              {friends.incoming.map((f: any) => (
                <li
                  key={f.id}
                  className="flex items-center gap-3 border-b border-line px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {f.requester.display_name}
                    </div>
                    <div className="text-[11px] text-sub">@{f.requester.handle}</div>
                  </div>
                  <FriendActions friendshipId={f.id} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
            フレンド（{friends.accepted.length}人）
          </h2>
          {friends.accepted.length === 0 ? (
            <p className="px-6 py-10 text-center text-xs leading-relaxed text-sub">
              まだフレンドがいません。
              <br />
              ユーザーIDか表示名で検索して申請しましょう。
            </p>
          ) : (
            <ul>
              {friends.accepted.map((f: any) => (
                <li key={f.id}>
                  <Link
                    href={`/u/${f.handle}`}
                    className="flex items-center gap-3 border-b border-line px-4 py-3 active:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{f.display_name}</div>
                      <div className="text-[11px] text-sub">@{f.handle}</div>
                    </div>
                    <span className="text-sub">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {friends.outgoing.length > 0 && (
          <section>
            <h2 className="bg-gray-50 px-4 py-1.5 text-[11px] font-bold text-sub">
              申請中（{friends.outgoing.length}件）
            </h2>
            <ul>
              {friends.outgoing.map((f: any) => (
                <li key={f.id} className="border-b border-line px-4 py-3">
                  <div className="text-sm font-semibold">{f.addressee.display_name}</div>
                  <div className="text-[11px] text-sub">
                    @{f.addressee.handle} · 相手の承認を待っています
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
