import Link from 'next/link';
import { fmtPt } from '@/lib/format';

export function Header({
  title,
  balance,
  back,
}: {
  title: string;
  balance?: number | null;
  back?: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4">
        {back && (
          <Link href={back} className="-ml-2 p-2 text-lg text-sub" aria-label="戻る">
            ‹
          </Link>
        )}
        <h1 className="flex-1 truncate text-base font-bold">{title}</h1>
        {balance != null && (
          <div className="text-right">
            <div className="text-[10px] leading-none text-sub">持ちポイント</div>
            <div className="tabnum text-sm font-bold leading-tight">{fmtPt(balance)}</div>
          </div>
        )}
      </div>
    </header>
  );
}
