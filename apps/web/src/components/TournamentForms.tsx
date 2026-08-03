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
  setTournamentPrizes,
} from '@/app/actions';
import { fmtPt } from '@/lib/format';
import { findMoneyWord, PRIZE_MAX_LENGTH, PRIZE_RULE_TEXT } from '@/lib/prizes';

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
  const [prizes, setPrizes] = useState(['', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const prizeWarnings = prizes.map((p) => (p.trim() ? findMoneyWord(p) : null));
  const prizeBlocked = prizeWarnings.some(Boolean);

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
        <label className="mb-1 block text-[11px] font-bold text-sub">🎁 景品（任意）</label>
        <div className="space-y-1.5">
          {PRIZE_LABELS.map((label, i) => (
            <div key={label}>
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-xs font-bold text-sub">{label}</span>
                <input
                  value={prizes[i]}
                  onChange={(e) => {
                    const next = [...prizes];
                    next[i] = e.target.value;
                    setPrizes(next);
                  }}
                  maxLength={PRIZE_MAX_LENGTH}
                  placeholder={PRIZE_PLACEHOLDERS[i]}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                    prizeWarnings[i] ? 'border-red-400 bg-red-50' : 'border-line'
                  }`}
                />
              </div>
              {prizeWarnings[i] && (
                <p className="ml-10 mt-1 text-[11px] text-red-600">
                  「{prizeWarnings[i]}」は景品にできません
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-sub">{PRIZE_RULE_TEXT}</p>
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
        disabled={pending || name.trim().length === 0 || prizeBlocked}
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
            if (!res.ok) {
              setError(res.error);
              return;
            }
            // 景品は作ったあとに別で保存する。
            // ここで失敗しても大会は残るので、大会ページから書き直せる。
            if (prizes.some((p) => p.trim())) {
              const pf = new FormData();
              pf.set('tournamentId', res.id);
              prizes.forEach((p, i) => pf.set(`prize${i + 1}`, p));
              await setTournamentPrizes(pf);
            }
            router.push(`/tournaments/${res.id}`);
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

const PRIZE_LABELS = ['1位', '2位', '3位'];
const PRIZE_PLACEHOLDERS = [
  '例：焼肉おごり',
  '例：ラーメンおごり',
  '例：自販機のジュース',
];

/**
 * 景品を決める（主催者だけ）。
 *
 * 換金できるものは書けない。入力中にその場で警告を出し、
 * 保存もさせない。サーバー側でも同じチェックをしている。
 */
export function PrizeForm({
  tournamentId,
  initial,
}: {
  tournamentId: string;
  initial: [string, string, string];
}) {
  const [prizes, setPrizes] = useState<string[]>([...initial]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  // 入力中の警告。書いた瞬間に気づけるようにしている。
  const warnings = prizes.map((p) => (p.trim() ? findMoneyWord(p) : null));
  const blocked = warnings.some(Boolean);

  return (
    <div>
      <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
        {PRIZE_RULE_TEXT}
      </div>

      <div className="space-y-2">
        {PRIZE_LABELS.map((label, i) => (
          <div key={label}>
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs font-bold text-sub">{label}</span>
              <input
                value={prizes[i]}
                onChange={(e) => {
                  const next = [...prizes];
                  next[i] = e.target.value;
                  setPrizes(next);
                  setSaved(false);
                  setError(null);
                }}
                maxLength={PRIZE_MAX_LENGTH}
                placeholder={PRIZE_PLACEHOLDERS[i]}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                  warnings[i] ? 'border-red-400 bg-red-50' : 'border-line'
                }`}
              />
            </div>
            {warnings[i] && (
              <p className="ml-10 mt-1 text-[11px] text-red-600">
                「{warnings[i]}」は景品にできません
              </p>
            )}
          </div>
        ))}
      </div>

      <button
        disabled={pending || blocked}
        onClick={() => {
          setError(null);
          const fd = new FormData();
          fd.set('tournamentId', tournamentId);
          prizes.forEach((p, i) => fd.set(`prize${i + 1}`, p));
          start(async () => {
            const res = await setTournamentPrizes(fd);
            if (res.ok) {
              setSaved(true);
              router.refresh();
            } else setError(res.error);
          });
        }}
        className="mt-3 rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white
                   disabled:bg-gray-300"
      >
        {pending ? '保存中…' : '景品を保存'}
      </button>
      {saved && <span className="ml-2 text-[11px] text-green-700">保存しました</span>}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      <p className="mt-2 text-[10px] leading-relaxed text-sub">
        空欄にすれば、その順位の景品はなしになります。
        <br />
        終わった大会の景品は変えられません。
      </p>
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
