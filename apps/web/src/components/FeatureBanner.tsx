import Link from 'next/link';
import { Countdown } from '@/components/Countdown';
import { fmtTime, fmtPt } from '@/lib/format';
import { calcCashback, type DailyFeature } from '@/lib/queries';

/**
 * 今日のお題レースの帯。
 *
 * このサイトで唯一「みんなが同じレースを買う」場所なので、
 * 開いた瞬間に目に入るよう、他とはっきり違う見た目にしている。
 */
export function FeatureBanner({
  feature,
  serverNow,
}: {
  feature: DailyFeature;
  serverNow: number;
}) {
  const open =
    feature.status === 'scheduled' &&
    new Date(feature.deadline_at).getTime() > serverNow;
  const pct = Math.round(feature.cashback_rate * 100);
  const back = calcCashback(feature.my_stake, feature.cashback_rate, feature.cashback_max);
  const done = feature.my_stake > 0;

  return (
    <Link
      href={`/races/${feature.event_id}`}
      className="block bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-3 text-white
                 active:opacity-90"
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">
          今日のお題
        </span>
        <span className="rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
          {pct}%キャッシュバック
        </span>
        {done && (
          <span className="rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">
            投票済
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-lg font-bold">
          {feature.venue_name} {feature.race_number}R
        </span>
        <span className="tabnum text-sm font-bold">{fmtTime(feature.deadline_at)}</span>
        {open && (
          <Countdown
            deadline={feature.deadline_at}
            serverNow={serverNow}
            className="!text-xs !text-white/90"
          />
        )}
      </div>

      <div className="mt-0.5 truncate text-[11px] text-white/80">{feature.title}</div>

      <div className="tabnum mt-1.5 text-[11px] text-white/90">
        {!open && feature.status === 'resolved' ? (
          '結果が出ました。タップして確認'
        ) : !open ? (
          '締め切りました'
        ) : done ? (
          <>
            {fmtPt(feature.my_stake)} 投票中 → <b className="text-sm">{fmtPt(back)}</b> 戻ります
          </>
        ) : (
          <>
            賭けた額の <b className="text-sm">{pct}%</b> が戻ります（当たっても外れても・最大{' '}
            {fmtPt(feature.cashback_max)}）
          </>
        )}
      </div>
    </Link>
  );
}
