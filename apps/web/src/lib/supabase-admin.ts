import { createClient } from '@supabase/supabase-js';

/**
 * 管理者権限のクライアント。
 *
 * 精算（投票の当たり外れ確定とポイント台帳への記帳）は、利用者本人には
 * 書き換えさせられない処理なので、この鍵でしか行わない。
 * 鍵は Vercel の環境変数にだけ置き、ブラウザには絶対に渡さない。
 * （NEXT_PUBLIC_ を付けないこと。付けるとブラウザに配信されてしまう）
 */
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
