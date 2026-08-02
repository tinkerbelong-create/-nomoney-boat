'use client';

/**
 * ログイン / 新規登録。
 *
 * メールアドレスとパスワードでアカウントを作る。
 * メールアドレスがアカウントの識別子になるので、同じメールで二重登録はできない。
 *
 * 登録後は /onboarding でユーザーIDと表示名を決める。
 * つまりアカウントは「メールアドレス（本人確認）＋ ユーザーID（フレンド検索用）」
 * の2段構えになっている。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

type Mode = 'login' | 'signup' | 'forgot';

const MIN_PASSWORD = 8;

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    const supabase = supabaseBrowser();

    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/auth/reset`,
        });
        if (error) throw error;
        setNotice(
          'パスワード再設定用のメールを送りました。届いたリンクを開いてください。',
        );
        return;
      }

      if (mode === 'signup') {
        if (password.length < MIN_PASSWORD) {
          setError(`パスワードは${MIN_PASSWORD}文字以上にしてください`);
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;

        // メール確認が必要な設定の場合、session が返ってこない
        if (!data.session) {
          setNotice(
            `${email} に確認メールを送りました。リンクを開くと登録が完了します。`,
          );
          return;
        }

        router.push('/onboarding');
        router.refresh();
        return;
      }

      // ログイン
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      router.push('/');
      router.refresh();
    } catch (err) {
      setError(translateError((err as Error).message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mb-8 text-center">
        <div className="text-5xl">🚤</div>
        <h1 className="mt-3 text-xl font-bold">ノーマネー予想対戦</h1>
        <p className="mt-2 text-xs leading-relaxed text-sub">
          ボートレースの結果で、友達とポイントの収支を競うサイトです。
          <br />
          <strong className="text-ink">お金は一切かかりません。</strong>
          <br />
          ポイントに換金性はありません。
        </p>
      </div>

      {/* ログイン / 新規登録 の切り替え */}
      {mode !== 'forgot' && (
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
          {(
            [
              { key: 'login', label: 'ログイン' },
              { key: 'signup', label: '新規登録' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => switchMode(t.key)}
              className={`rounded-lg py-2 text-sm font-bold transition ${
                mode === t.key ? 'bg-white text-ink shadow-sm' : 'text-sub'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'forgot' && (
        <h2 className="mb-3 text-center text-sm font-bold">パスワードの再設定</h2>
      )}

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold text-sub">メールアドレス</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full rounded-xl border border-line px-4 py-3 text-sm"
          />
        </div>

        {mode !== 'forgot' && (
          <div>
            <label className="mb-1 block text-xs font-bold text-sub">パスワード</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`${MIN_PASSWORD}文字以上`}
              minLength={MIN_PASSWORD}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="w-full rounded-xl border border-line px-4 py-3 text-sm"
            />
            {mode === 'signup' && (
              <p className="mt-1 text-[11px] text-sub">
                {MIN_PASSWORD}文字以上。他のサービスと同じものは避けてください。
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-white disabled:bg-gray-300"
        >
          {loading
            ? '処理中…'
            : mode === 'signup'
              ? 'アカウントを作る'
              : mode === 'forgot'
                ? '再設定メールを送る'
                : 'ログイン'}
        </button>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
        {notice && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs leading-relaxed text-green-800">
            {notice}
          </p>
        )}
      </form>

      <div className="mt-4 text-center">
        {mode === 'login' && (
          <button
            onClick={() => switchMode('forgot')}
            className="text-xs text-sub underline"
          >
            パスワードを忘れた
          </button>
        )}
        {mode === 'forgot' && (
          <button
            onClick={() => switchMode('login')}
            className="text-xs text-sub underline"
          >
            ログインに戻る
          </button>
        )}
      </div>

      <p className="mt-10 text-center text-[10px] leading-relaxed text-sub">
        本サイトは公営競技の結果を利用した非営利のファンサイトです。
        <br />
        実際の舟券を購入する機能や、そのための導線はありません。
      </p>
    </main>
  );
}

/** Supabase のエラーメッセージを日本語にする */
function translateError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'メールアドレスかパスワードが違います';
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'このメールアドレスは登録済みです。ログインしてください。';
  }
  if (m.includes('email not confirmed')) {
    return 'メールの確認が済んでいません。届いているリンクを開いてください。';
  }
  if (m.includes('password should be at least')) {
    return `パスワードは${MIN_PASSWORD}文字以上にしてください`;
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return '短時間に試しすぎです。少し待ってからもう一度お試しください。';
  }
  if (m.includes('unable to validate email')) {
    return 'メールアドレスの形式が正しくありません';
  }
  return message;
}
