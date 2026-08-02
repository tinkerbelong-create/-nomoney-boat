'use client';

import { useEffect, useState } from 'react';
import { timeLeft } from '@/lib/format';

/**
 * 締切までのカウントダウン。
 *
 * 端末の時計はずれていることがあるので、基準時刻はサーバから受け取る。
 * 表示のずれだけならまだしも、投票可否の判定を端末時計でやると
 * 「一部の人だけ投票できない」という原因不明の不具合になる。
 */
export function Countdown({
  deadline,
  serverNow,
  className = '',
}: {
  deadline: string;
  serverNow: number;
  className?: string;
}) {
  // サーバ時刻とブラウザ時刻の差を最初に測り、以後はその補正を効かせる
  const [offset] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [offset]);

  const left = new Date(deadline).getTime() - now;
  const urgent = left > 0 && left <= 5 * 60 * 1000;

  return (
    <div
      className={`text-[11px] font-semibold ${
        left <= 0 ? 'text-sub' : urgent ? 'text-red-600' : 'text-sub'
      } ${className}`}
    >
      {timeLeft(deadline, now)}
    </div>
  );
}
