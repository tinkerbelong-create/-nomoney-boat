'use client';

import { useTransition } from 'react';
import { respondFriendRequest } from '@/app/actions';

export function FriendActions({ friendshipId }: { friendshipId: string }) {
  const [pending, start] = useTransition();

  const respond = (accept: boolean) =>
    start(async () => {
      await respondFriendRequest(friendshipId, accept);
    });

  return (
    <div className="flex shrink-0 gap-2">
      <button
        onClick={() => respond(false)}
        disabled={pending}
        className="rounded-lg border border-line px-3 py-1.5 text-xs text-sub disabled:opacity-50"
      >
        拒否
      </button>
      <button
        onClick={() => respond(true)}
        disabled={pending}
        className="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        承認
      </button>
    </div>
  );
}
