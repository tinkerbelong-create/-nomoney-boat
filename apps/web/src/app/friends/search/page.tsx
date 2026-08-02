'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { sendFriendRequest } from '@/app/actions';

/**
 * フレンド検索。
 * ユーザーID（handle）の前方一致と、表示名の部分一致で探す。
 */
export default function FriendSearchPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;

    const supabase = supabaseBrowser();
    const { data } = await supabase
      .from('profiles')
      .select('id, handle, display_name')
      .or(`handle.ilike.${term}%,display_name.ilike.%${term}%`)
      .limit(20);

    setResults(data ?? []);
    setSearched(true);
  };

  const request = (userId: string) =>
    start(async () => {
      const res = await sendFriendRequest(userId);
      setSent((s) => ({ ...s, [userId]: res.ok ? '申請しました' : res.error }));
    });

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 px-4 backdrop-blur">
        <div className="flex h-14 items-center gap-2">
          <Link href="/friends" className="-ml-2 p-2 text-lg text-sub">
            ‹
          </Link>
          <h1 className="text-base font-bold">フレンドを探す</h1>
        </div>
      </header>

      <main className="pb-tab">
        <form onSubmit={search} className="flex gap-2 px-4 py-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ユーザーID または 表示名"
            className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-xl bg-ink px-5 text-sm font-bold text-white"
          >
            検索
          </button>
        </form>

        {searched && results.length === 0 && (
          <p className="px-6 py-10 text-center text-xs text-sub">
            見つかりませんでした。
          </p>
        )}

        <ul>
          {results.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.display_name}</div>
                <div className="text-[11px] text-sub">@{r.handle}</div>
              </div>
              {sent[r.id] ? (
                <span className="shrink-0 text-[11px] text-sub">{sent[r.id]}</span>
              ) : (
                <button
                  onClick={() => request(r.id)}
                  disabled={pending}
                  className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  申請
                </button>
              )}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
