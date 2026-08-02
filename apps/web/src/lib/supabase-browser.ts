'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * ブラウザ側の Supabase クライアント。
 *
 * サーバー専用の機能（next/headers など）をこのファイルに書いてはいけない。
 * 書くと「クライアントコンポーネントからサーバー専用の機能を読んでいる」
 * というエラーになり、ビルドが通らなくなる。
 * サーバー側は supabase.ts のほうを使うこと。
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
