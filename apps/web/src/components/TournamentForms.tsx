'use client';

/**
 * 大会を作る / 招待コードで参加する / アナウンスを書く / 対象レースを選ぶ。
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createTournament,
  joinTournament,
  setTournamentRace,
  setTournamentAnnouncement,
} from '@/app/actions';
import { fmtPt } from '@/lib/format';

const DAYS = [
  { v: 1, label: '1日' },
  { v: 7, label: '1週間' },
  { v: 14, label: '2週間' },
];

const FEES = [1000, 3000, 5000, 10000];

export function CreateTournamentForm({ balance }: { balance: number }) {
  const [name, setName] = useState('');
  const [fee, setFee] = useState(5000);
  const [days, setDays] = useState(1);
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[11px] font-bold text-sub">大会名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="例：第1回 みんなで5000pt杯"
          className="w-full rounded-lg border border-line px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-bold text-sub">
          参加費（＝全員の開始ポイント）
        </label>
        <div className="flex gap-1">
          {FEES.map((f) => (
            <button
              key={f}
              onClick={() => setFee(f)}
              className={`flex-1 rounded-lg py-2 text-xs font-bold ${
                fee === f ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-sub'
              }`}
            >
              {f.toLocaleString()}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-sub">
          全員が同じ額から始まります。持ちポイントの多さは関係ありません。
          <br />
          あなたの持ちポイント {fmtPt(balance)}
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-bold text-sub">期間</label>
        <div className="flex gap-1">
          {DAYS.map((d) => (
            <button
              key={d.v}
              onClick={() => setDays(d.v)}
              className={`flex-1 rounded-lg py-2 text-xs font-bold ${
                days === d.v ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-sub'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-bold text-sub">対象レース</label>
        <div className="flex gap-1">
          <button
            onClick={() => setScope('selected')}
            className={`flex-1 rounded-lg py-2 text-xs font-bold ${
              scope === 'selected' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-sub'
            }`}
          >
            指定したレースだけ
          </button>
          <button
            onClick={() => setScope('all')}
            className={`flex-1 rounded-lg py-2 text-xs font-bold ${
              scope === 'all' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-sub'
            }`}
          >
            期間中の全レース
          </button>
        </div>
        <p className="mt-1 text-[10px] text-sub">
          {scope === 'selected'
            ? '作ったあとに、期間の中からレースを選びます。'
            : '期間中ならどのレースを買ってもかまいません。'}
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-bold text-sub">
          アナウンス（任意）
        </label>
        <textarea
          value={announcement}
          onChange={(e) => setAnnouncement(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="ルールや意気込みを書いてください"
          className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm"
        />
      </div>

      <button
        disabled={pending || name.trim().length === 0}
        onClick={() => {
          setError(null);
          const fd = new FormData();
          fd.set('name', name);
          fd.set('entryFee', String(fee));
          fd.set('days', String(days));
          fd.set('scope', scope);
          fd.set('announcement', announcement);
          start(async () => {
            const res = await createTournament(fd);
            if (res.ok) router.push(`/tournaments/${res.id}`);
            else setError(res.error);
          });
        }}
        className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white
                   disabled:bg-gray-300"
      >
        大会を作る
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <p className="text-[10px] leading-relaxed text-sub">
        作っただけでは参加になりません。作ったあと、自分も招待コードで参加してください。
      </p>
    </div>
  );
}

export function JoinTournamentForm() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={8}
          placeholder="招待コード"
          className="tabnum flex-1 rounded-lg border border-line px-3 py-2 text-center text-lg
                     font-bold tracking-widest"
        />
        <button
          disabled={pending || code.trim().length < 4}
          onClick={() => {
            setError(null);
            const fd = new FormData();
            fd.set('code', code);
            start(async () => {
              const res = await joinTournament(fd);
              if (res.ok) {
                setCode('');
                router.push(`/tournaments/${res.id}`);
              } else setError(res.error);
            });
          }}
          className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white
                     disabled:bg-gray-300"
        >
          参加
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      <p className="mt-1 text-[10px] text-sub">
        参加すると、持ちポイントから参加費が引かれて大会ポイントになります。
      </p>
    </div>
  );
}

export function AnnouncementForm({
  tournamentId,
  initial,
}: {
  tournamentId: string;
  initial: string;
}) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        rows={4}
        maxLength={500}
        className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm"
      />
      <button
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set('tournamentId', tournamentId);
          fd.set('text', text);
          start(async () => {
            await setTournamentAnnouncement(fd);
            setSaved(true);
            router.refresh();
          });
        }}
        className="mt-2 rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white"
      >
        {pending ? '保存中…' : '保存'}
      </button>
      {saved && <span className="ml-2 text-[11px] text-green-700">保存しました</span>}
    </div>
  );
}

export function RaceToggle({
  tournamentId,
  eventId,
  on,
}: {
  tournamentId: string;
  eventId: string;
  on: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <button
      disabled={pending}
      onClick={() => {
        const fd = new FormData();
        fd.set('tournamentId', tournamentId);
        fd.set('eventId', eventId);
        fd.set('add', on ? '0' : '1');
        start(async () => {
          await setTournamentRace(fd);
          router.refresh();
        });
      }}
      className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${
        on ? 'bg-emerald-600 text-white' : 'border border-line text-sub'
      } disabled:opacity-40`}
    >
      {on ? '対象' : '追加'}
    </button>
  );
}
