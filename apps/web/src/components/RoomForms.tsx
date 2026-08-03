'use client';

/**
 * 部屋を作る / 招待コードで入る / メッセージを送る。
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom, joinRoom, postRoomMessage, leaveRoom } from '@/app/actions';

export function CreateRoomForm() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="部屋の名前（例：会社の同期）"
          maxLength={30}
          className="flex-1 rounded-lg border border-line px-3 py-2 text-sm"
        />
        <button
          disabled={pending || name.trim().length === 0}
          onClick={() => {
            setError(null);
            const fd = new FormData();
            fd.set('name', name);
            start(async () => {
              const res = await createRoom(fd);
              if (res.ok) {
                setName('');
                router.push(`/rooms/${res.roomId}`);
              } else setError(res.error);
            });
          }}
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white
                     disabled:bg-gray-300"
        >
          作る
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

export function JoinRoomForm() {
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
          placeholder="招待コード（例：K7M2XQ）"
          maxLength={8}
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
              const res = await joinRoom(fd);
              if (res.ok) {
                setCode('');
                router.push(`/rooms/${res.roomId}`);
              } else setError(res.error);
            });
          }}
          className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white
                     disabled:bg-gray-300"
        >
          入る
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

export function MessageForm({ roomId }: { roomId: string }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const send = () => {
    if (body.trim().length === 0) return;
    setError(null);
    const fd = new FormData();
    fd.set('roomId', roomId);
    fd.set('body', body);
    start(async () => {
      const res = await postRoomMessage(fd);
      if (res.ok) {
        setBody('');
        router.refresh();
      } else if (res.error) setError(res.error);
    });
  };

  return (
    <div className="sticky bottom-16 border-t border-line bg-white px-4 py-2">
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
          rows={1}
          maxLength={500}
          placeholder="メッセージを書く"
          className="max-h-24 flex-1 resize-none rounded-2xl border border-line px-3 py-2 text-sm"
        />
        <button
          onClick={send}
          disabled={pending || body.trim().length === 0}
          className="shrink-0 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white
                     disabled:bg-gray-300"
        >
          送信
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

export function LeaveRoomButton({ roomId }: { roomId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div>
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm('この部屋を出ますか？')) return;
          const fd = new FormData();
          fd.set('roomId', roomId);
          start(async () => {
            const res = await leaveRoom(fd);
            if (res.ok) router.push('/rooms');
            else setError(res.error);
          });
        }}
        className="w-full rounded-xl border border-line py-2.5 text-xs text-sub"
      >
        この部屋を出る
      </button>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
