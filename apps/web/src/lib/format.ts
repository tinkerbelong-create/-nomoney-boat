/** 表示用のフォーマット */

export const fmtPt = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toLocaleString('ja-JP')}pt`;

export const fmtSigned = (n: number | null | undefined) => {
  if (n == null) return '—';
  const s = n.toLocaleString('ja-JP');
  return n > 0 ? `+${s}` : s;
};

export const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(1)}%`;

/** JSTの HH:MM */
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  });

/** 収支の色 */
export const profitColor = (n: number) =>
  n > 0 ? 'text-red-600' : n < 0 ? 'text-blue-600' : 'text-sub';

/** 艇番の背景色クラス。実際の枠色に合わせている。 */
export const laneClass = (lane: string) =>
  ({
    '1': 'bg-white text-ink border border-line',
    '2': 'bg-gray-900 text-white',
    '3': 'bg-red-600 text-white',
    '4': 'bg-blue-600 text-white',
    '5': 'bg-yellow-400 text-ink',
    '6': 'bg-green-600 text-white',
  })[lane] ?? 'bg-gray-200 text-ink';

/** 締切までの残り時間 */
export function timeLeft(deadlineIso: string, nowMs: number): string {
  const diff = new Date(deadlineIso).getTime() - nowMs;
  if (diff <= 0) return '締切';
  const m = Math.floor(diff / 60000);
  if (m >= 60) return `${Math.floor(m / 60)}時間${m % 60}分`;
  if (m >= 1) return `あと${m}分`;
  return `あと${Math.floor(diff / 1000)}秒`;
}
