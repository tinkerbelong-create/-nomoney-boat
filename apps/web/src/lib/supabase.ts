import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * サーバー側の Supabase クライアント。
 *
 * next/headers を使うので、このファイルはサーバーコンポーネント・
 * Server Action・API ルートからしか読み込めない。
 * ブラウザ側（'use client' が付いた画面）からは supabase-browser.ts を使うこと。
 *
 * 以前は同じファイルにブラウザ用も同居させていたが、
 * クライアント側から読むと next/headers が巻き込まれてビルドが失敗するため分離した。
 */
export async function supabaseServer() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server Component からは Cookie を書けない。middleware 側で更新される。
          }
        },
      },
    },
  );
}

/** ログイン中のユーザー。未ログインなら null。 */
export async function getSessionUser() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
