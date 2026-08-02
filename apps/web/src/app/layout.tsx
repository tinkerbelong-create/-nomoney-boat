import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ノーマネー予想対戦',
  description:
    'ボートレースの結果を使って、現金ではなくポイントで友達と収支を competing するサイト。換金性は一切ありません。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0f1720',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="mx-auto min-h-dvh w-full max-w-[560px] bg-white shadow-sm">
          {children}
        </div>
      </body>
    </html>
  );
}
