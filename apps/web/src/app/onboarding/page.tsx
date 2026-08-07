'use client';

import { useState, useTransition } from 'react';
import { createProfile } from '@/app/actions';

export default function OnboardingPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (fd: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await createProfile(fd);
      if (res && !res.ok) setError(res.error);
    });
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <h1 className="text-lg font-bold">プロフィールを作る</h1>
      <p className="mt-1 text-xs leading-relaxed text-sub">
        あと少しで完了です。
        <br />
        <strong className="text-ink">ユーザーIDはフレンド検索に使われます。</strong>
        友達に教える名前になるので、覚えやすいものにしてください。
      </p>

      <form action={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-xs font-bold text-sub">ユーザーID</label>
          <div className="flex items-center rounded-xl border border-line px-4">
            <span className="text-sm text-sub">@</span>
            <input
              name="handle"
              required
              pattern="[a-zA-Z0-9_]{3,20}"
              placeholder="boat_taro"
              className="w-full bg-transparent py-3 text-sm outline-none"
            />
          </div>
          <p className="mt-1 text-[11px] text-sub">半角英数字と _ の3〜20文字</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-sub">表示名</label>
          <input
            name="display_name"
            required
            maxLength={30}
            placeholder="ボート太郎"
            className="w-full rounded-xl border border-line px-4 py-3 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-white disabled:bg-gray-300"
        >
          {pending ? '作成中…' : 'はじめる'}
        </button>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>

      <p className="mt-8 rounded-xl bg-amber-50 p-4 text-[11px] leading-relaxed text-sub">
        登録すると <strong className="text-ink">50,000pt</strong> が配られます。
        そのあとは <strong className="text-ink">毎週木曜日に5,000pt</strong>。
        使い切ってもなくなりません。
        <br />
        このポイントに換金性はありません。
      </p>
    </main>
  );
}
