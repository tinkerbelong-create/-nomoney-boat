import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

/**
 * メールのリンクから戻ってきたときの入口。
 *
 * 次の2つの経路がある。
 *   1. 新規登録の確認メール     → セッションを確立して /onboarding へ
 *   2. パスワード再設定のメール → セッションを確立して /auth/reset へ
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const type = searchParams.get('type');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?e=missing_code`);
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?e=expired`);
  }

  // パスワード再設定は専用画面へ
  if (type === 'recovery') {
    return NextResponse.redirect(`${origin}/auth/reset`);
  }

  // プロフィール未作成ならオンボーディングへ
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) return NextResponse.redirect(`${origin}/onboarding`);
  }

  return NextResponse.redirect(origin);
}
