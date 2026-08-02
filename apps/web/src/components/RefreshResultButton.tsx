'use client';

/**
 * 結果の「更新」ボタン。
 *
 * 15分ごとの自動処理を待たずに、そのレースの結果を取りに行って精算する。
 * 「まだ反映されていないのか、そもそも動いていないのか」が分からないと不安なので、
 * 押した結果を必ず文章で返すようにしている。
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const MESSAGES: Record<string, string> = {
  settled: '結果を反映しました',
  already: 'このレースはすでに反映済みです',
  too_early: 'まだ締切前です',
  pending: '公式サイトにまだ結果が出ていません。数分後にもう一度お試しください',
  cancelled: '中止のレースです',
  not_found: 'レースが見つかりませんでした',
  unauthorized: 'ログインし直してください',
};

export function RefreshResultButton({
  eventId,
  label = '結果を更新',
}: {
  eventId: string;
  label?: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = () => {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/refresh/${eventId}`, { method: 'POST' });
        const d = await res.json();

        if (d.status === 'settled') {
          setOk(true);
          setMsg(
            `結果を反映しました（的中${d.won ?? 0}・外れ${d.lost ?? 0}` +
              (d.refunded ? `・返還${d.refunded}` : '') +
              '）',
          );
          router.refresh();
          return;
        }

        setOk(d.status === 'already');
        setMsg(d.message ?? MESSAGES[d.status] ?? `不明な状態: ${d.status}`);
        if (d.status === 'already') router.refresh();
      } catch (e) {
        setOk(false);
        setMsg(String(e));
      }
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold
                   active:bg-gray-50 disabled:opacity-40"
      >
        {pending ? '確認中…' : `↻ ${label}`}
      </button>
      {msg && (
        <p className={`mt-1.5 text-[11px] ${ok ? 'text-green-700' : 'text-red-600'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}
