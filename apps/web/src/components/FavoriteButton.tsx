'use client';

/**
 * お気に入り選手の★ボタン。
 * 一覧でも出走表でも同じものを使う。
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addFavoriteRacer, removeFavoriteRacer } from '@/app/actions';

export function FavoriteButton({
  racerId,
  name,
  initialOn,
  size = 'md',
}: {
  racerId: string;
  name: string;
  initialOn: boolean;
  size?: 'sm' | 'md';
}) {
  const [on, setOn] = useState(initialOn);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = () => {
    setError(null);
    const next = !on;
    setOn(next); // 先に見た目を変える。失敗したら戻す。

    const fd = new FormData();
    fd.set('racerId', racerId);
    fd.set('name', name);

    startTransition(async () => {
      const res = next ? await addFavoriteRacer(fd) : await removeFavoriteRacer(fd);
      if (!res.ok) {
        setOn(!next);
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={on ? 'お気に入りから外す' : 'お気に入りに登録'}
        className={`shrink-0 leading-none transition ${
          size === 'sm' ? 'text-lg' : 'text-2xl'
        } ${on ? 'text-amber-400' : 'text-gray-300'} ${pending ? 'opacity-40' : ''}`}
      >
        {on ? '★' : '☆'}
      </button>
      {error && <span className="mt-0.5 text-[10px] text-red-600">{error}</span>}
    </span>
  );
}
