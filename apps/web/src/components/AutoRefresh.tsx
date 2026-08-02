'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 画面を自動で更新する。
 *
 * レース一覧や結果は、ワーカーが裏で書き換えていく。
 * 利用者が自分でリロードしないと締切や結果が反映されないのでは
 * 「リアルタイムで賭けている」感覚にならないため、定期的に取り直す。
 *
 * router.refresh() はサーバコンポーネントだけを再取得して差分を当てるので、
 * 画面のスクロール位置も入力中の状態も保たれる。
 * タブが裏に回っているあいだは止めて、無駄なリクエストを出さない。
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        router.refresh(); // 戻ってきた瞬間に最新へ
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
