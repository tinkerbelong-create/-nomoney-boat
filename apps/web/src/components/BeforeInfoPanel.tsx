'use client';

/**
 * 直前情報の表示。
 *
 * 展示タイムとスタート展示は、締切直前の予想でいちばん見られる数字。
 * レースを開いたときに取りに行く（オッズと同じ仕組み）。
 */

import { useEffect, useState } from 'react';
import { laneClass } from '@/lib/format';

interface Info {
  racers: {
    slot: string;
    name: string;
    weight?: string;
    exhibitionTime?: string;
    tilt?: string;
    parts?: string;
  }[];
  start: { course: number; slot: string; st: string }[];
  weather: {
    airTemp?: string;
    waterTemp?: string;
    windSpeed?: string;
    waveHeight?: string;
    condition?: string;
  };
  weatherAt?: string;
}

export function BeforeInfoPanel({
  eventId,
  officialUrl,
}: {
  eventId: string;
  officialUrl?: string;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  /**
   * 直前情報を取りに行く。
   * 展示タイムやスタート展示は締切の15分ほど前に順に出てくるので、
   * 「まだ出ていない」ときに押し直せるよう更新ボタンを用意している。
   */
  const load = (force = false) => {
    setLoading(true);
    return fetch(`/api/beforeinfo/${eventId}${force ? '?fresh=1' : ''}`)
      .then((r) => r.json())
      .then((d) => {
        setInfo(d.info ?? null);
        setNote(d.detail ?? d.error ?? null);
        setCheckedAt(new Date());
      })
      .catch((e) => setNote(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // 展示タイムの速い順に順位を付ける（1番速い艇を目立たせる）
  const times = (info?.racers ?? [])
    .map((r) => Number(r.exhibitionTime))
    .filter((n) => Number.isFinite(n) && n > 0);
  const best = times.length > 0 ? Math.min(...times) : null;

  return (
    <section>
      <div className="flex items-center justify-between gap-2 bg-gray-50 px-4 py-1.5">
        <h2 className="text-[11px] font-bold text-sub">
          直前情報
          <span className="ml-2 font-normal">
            {loading ? '取得中…' : checkedAt ? `${fmtClock(checkedAt)} 取得` : ''}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="shrink-0 rounded-full border border-line bg-white px-3 py-1
                     text-[11px] font-semibold active:bg-gray-50 disabled:opacity-40"
        >
          {loading ? '更新中…' : '↻ 更新'}
        </button>
      </div>

      {loading && <p className="px-4 py-3 text-[11px] text-sub">読み込み中…</p>}

      {!loading && !info && (
        <div className="px-4 py-3">
          <p className="text-[11px] text-sub">
            {note ?? 'まだ直前情報は出ていません（発走の15分ほど前に出ます）'}
          </p>
          {officialUrl && (
            <a
              href={officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block rounded-full border border-line px-4 py-1.5 text-xs font-semibold"
            >
              公式サイトの直前情報を見る ↗
            </a>
          )}
        </div>
      )}

      {info && (
        <>
          {/* 展示タイム */}
          {info.racers.some((r) => r.exhibitionTime) && (
            <div className="px-4 py-2">
              <div className="mb-1 text-[10px] font-bold text-sub">展示タイム</div>
              <div className="grid grid-cols-6 gap-1">
                {info.racers.map((r) => {
                  const isBest =
                    best !== null && Number(r.exhibitionTime) === best;
                  return (
                    <div key={r.slot} className="text-center">
                      <div
                        className={`mx-auto flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${laneClass(
                          r.slot,
                        )}`}
                      >
                        {r.slot}
                      </div>
                      <div
                        className={`tabnum mt-0.5 text-xs font-bold ${
                          isBest ? 'text-red-600' : ''
                        }`}
                      >
                        {r.exhibitionTime ?? '—'}
                      </div>
                      {r.tilt && r.tilt !== '0.0' && (
                        <div className="text-[9px] text-sub">チルト{r.tilt}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-sub">
                数字が小さいほど速い。赤は最速。
              </p>
            </div>
          )}

          {/* スタート展示 */}
          {info.start.length > 0 && (
            <div className="border-t border-line px-4 py-2">
              <div className="mb-1 text-[10px] font-bold text-sub">
                スタート展示（進入の内側から）
              </div>
              <div className="flex gap-1 overflow-x-auto">
                {info.start.map((s) => (
                  <div key={s.course} className="shrink-0 text-center">
                    <div className="text-[9px] text-sub">{s.course}コース</div>
                    <div
                      className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold ${laneClass(
                        s.slot,
                      )}`}
                    >
                      {s.slot}
                    </div>
                    <div
                      className={`tabnum mt-0.5 text-[11px] font-semibold ${
                        s.st.startsWith('F') ? 'text-red-600' : ''
                      }`}
                    >
                      {s.st || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 気象 */}
          {info.weather.airTemp && (
            <div className="border-t border-line px-4 py-2">
              <div className="tabnum flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sub">
                {info.weather.condition && <span>{info.weather.condition}</span>}
                <span>気温 {info.weather.airTemp}℃</span>
                <span>水温 {info.weather.waterTemp}℃</span>
                <span>風速 {info.weather.windSpeed}m</span>
                <span>波高 {info.weather.waveHeight}cm</span>
                {info.weatherAt && <span>（{info.weatherAt}）</span>}
              </div>
            </div>
          )}
          {officialUrl && (
            <div className="border-t border-line px-4 py-2">
              <a
                href={officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-sub underline"
              >
                部品交換・プロペラ・前走成績など、もっと詳しく（公式サイト）↗
              </a>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** 「13:45 取得」のような表示用 */
function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
