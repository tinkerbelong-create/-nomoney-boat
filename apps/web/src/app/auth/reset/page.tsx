'use client';

/**
 * パスワードの再設定。
 * 再設定メールのリンクを開くと、一時的にログイン済みの状態でここに来る。
 * その状態で新しいパスワードを設定する。
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

const MIN_PASSWORD = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // メールのリンクから来たセッションが確立しているか確認する
  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setError(
          'リンクの有効期限が切れているようです。もう一度メールを送ってください。',
        );
      }
      setReady(true);
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`パスワードは${MIN_PASSWORD}文字以上にしてください`);
      return;
    }
    if (password !== confirm) {
      setError('確認用のパスワードが一致しません');
      return;
    }

    setLoading(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push('/');
    router.refresh();
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <h1 className="mb-1 text-lg font-bold">新しいパスワード</h1>
      <p className="mb-6 text-xs text-sub">{MIN_PASSWORD}文字以上で設定してください。</p>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="新しいパスワード"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          className="w-full rounded-xl border border-line px-4 py-3 text-sm"
        />
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="もう一度入力"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          className="w-full rounded-xl border border-line px-4 py-3 text-sm"
        />

        <button
          type="submit"
          disabled={loading || !ready}
          className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-white disabled:bg-gray-300"
        >
          {loading ? '設定中…' : 'パスワードを変更する'}
        </button>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
