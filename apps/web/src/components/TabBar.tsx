'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'ランキング', icon: '🏆' },
  { href: '/races', label: 'レース', icon: '🚤' },
  { href: '/me/bets', label: '舟券', icon: '🎫' },
  { href: '/timeline', label: 'みんな', icon: '📣' },
  { href: '/me', label: 'マイ', icon: '👤' },
];

export function TabBar() {
  const path = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-1/2 z-40 w-full max-w-[560px] -translate-x-1/2
                 border-t border-line bg-white/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5">
        {TABS.map((t) => {
          // 「マイ」は /me/bets のときに光らせない（舟券タブと重なるため）
          const active =
            t.href === '/'
              ? path === '/'
              : t.href === '/me'
                ? path === '/me' || (path.startsWith('/me/') && !path.startsWith('/me/bets'))
                : path.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px]
                            ${active ? 'text-ink font-semibold' : 'text-sub'}`}
              >
                <span className="text-xl leading-none">{t.icon}</span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
