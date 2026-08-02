import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** ブラウザ側。RLS が効いた状態でしかアクセスできない。 */
export function supabaseBrowser() {
  return createBrowserClient(url(), anon());
}

/** サーバコンポーネント / Server Action 用 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(url(), anon(), {
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
  });
}

/** ログイン必須ページ用。未ログインなら null。 */
export async function getSessionUser() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
