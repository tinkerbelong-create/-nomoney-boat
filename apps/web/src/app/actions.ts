'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import {
  getBoatraceBetType,
  normalizeSelection,
  validateStake,
  assertValidLanes,
  BOATRACE_LANES,
} from '@/core';
import { findMoneyWord, PRIZE_MAX_LENGTH, PRIZE_PLEDGE_TEXT } from '@/lib/prizes';

/**
 * 投票する。
 *
 * 買い目の正規化はサーバ側でもう一度必ず行う。
 * クライアントが送ってきた文字列をそのまま信じると、
 * '2=1' のような非正規形が入って的中しなくなる。
 */
export async function placeBets(formData: FormData) {
  const marketId = String(formData.get('marketId') ?? '');
  const betTypeCode = String(formData.get('betTypeCode') ?? '');
  const stake = Number(formData.get('stake') ?? 0);
  const selectionsRaw = String(formData.get('selections') ?? '[]');

  const stakeCheck = validateStake(stake);
  if (!stakeCheck.ok) return { ok: false as const, error: stakeCheck.reason };

  let picksList: string[][];
  try {
    picksList = JSON.parse(selectionsRaw);
  } catch {
    return { ok: false as const, error: '買い目の形式が不正です' };
  }
  if (!Array.isArray(picksList) || picksList.length === 0) {
    return { ok: false as const, error: '買い目を選んでください' };
  }
  if (picksList.length > 100) {
    return { ok: false as const, error: '一度に投票できるのは100点までです' };
  }

  const betType = getBoatraceBetType(betTypeCode);

  const selections: string[] = [];
  for (const picks of picksList) {
    try {
      assertValidLanes(picks, BOATRACE_LANES);
      selections.push(normalizeSelection(betType, picks));
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }

  const supabase = await supabaseServer();

  // place_bet が残高チェック・締切チェック・台帳記帳をまとめて行う。
  // 1点ずつ呼ぶので、途中で残高が尽きたらそこで止まる。
  let placed = 0;
  for (const selection of [...new Set(selections)]) {
    const { error } = await supabase.rpc('place_bet', {
      p_market_id: marketId,
      p_selection: selection,
      p_stake: stake,
    });
    if (error) {
      if (placed > 0) {
        revalidatePath('/races');
        return {
          ok: false as const,
          error: `${placed}点だけ投票できました（${error.message}）`,
        };
      }
      return { ok: false as const, error: error.message };
    }
    placed += 1;
  }

  revalidatePath('/races');
  revalidatePath('/');
  return { ok: true as const, placed };
}

/** フレンド申請を送る */
export async function sendFriendRequest(addresseeId: string) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'ログインしてください' };
  if (user.id === addresseeId) return { ok: false as const, error: '自分には申請できません' };

  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: user.id, addressee_id: addresseeId });

  if (error) {
    if (error.code === '23505') {
      return { ok: false as const, error: 'すでに申請済みか、フレンドです' };
    }
    return { ok: false as const, error: error.message };
  }

  revalidatePath('/friends');
  return { ok: true as const };
}

/** 申請に応答する */
export async function respondFriendRequest(id: string, accept: boolean) {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from('friendships')
    .update({
      status: accept ? 'accepted' : 'declined',
      responded_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/friends');
  revalidatePath('/');
  return { ok: true as const };
}

/** プロフィール作成（オンボーディング） */
export async function createProfile(formData: FormData) {
  const handle = String(formData.get('handle') ?? '').trim().toLowerCase();
  const displayName = String(formData.get('display_name') ?? '').trim();

  if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
    return { ok: false as const, error: 'ユーザーIDは半角英数字と_の3〜20文字です' };
  }
  if (displayName.length < 1 || displayName.length > 30) {
    return { ok: false as const, error: '表示名は1〜30文字で入力してください' };
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'ログインしてください' };

  const { error } = await supabase
    .from('profiles')
    .insert({ id: user.id, handle, display_name: displayName });

  if (error) {
    if (error.code === '23505') {
      return { ok: false as const, error: 'そのユーザーIDは使われています' };
    }
    return { ok: false as const, error: error.message };
  }

  redirect('/');
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}

// =====================================================================
// お気に入り選手
// =====================================================================

/** お気に入りに追加する。10人を超えるとデータベース側で弾かれる。 */
export async function addFavoriteRacer(formData: FormData) {
  const racerId = String(formData.get('racerId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  if (!/^\d{3,5}$/.test(racerId)) {
    return { ok: false as const, error: '選手を特定できませんでした' };
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'ログインしてください' };

  const { error } = await supabase
    .from('favorite_racers')
    .insert({ user_id: user.id, racer_id: racerId, name });

  if (error) {
    if (error.code === '23505') return { ok: true as const }; // すでに登録済み
    if (/10人まで/.test(error.message)) {
      return { ok: false as const, error: 'お気に入り選手は10人までです' };
    }
    return { ok: false as const, error: error.message };
  }

  revalidatePath('/races');
  revalidatePath('/me/favorites');
  return { ok: true as const };
}

export async function removeFavoriteRacer(formData: FormData) {
  const racerId = String(formData.get('racerId') ?? '').trim();

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'ログインしてください' };

  const { error } = await supabase
    .from('favorite_racers')
    .delete()
    .eq('user_id', user.id)
    .eq('racer_id', racerId);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/races');
  revalidatePath('/me/favorites');
  return { ok: true as const };
}

// =====================================================================
// 大会
// =====================================================================

export async function createTournament(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const fee = Number(formData.get('entryFee') ?? 0);
  const days = Number(formData.get('days') ?? 1);
  const scope = String(formData.get('scope') ?? 'selected');
  const announcement = String(formData.get('announcement') ?? '');

  if (name.length < 1 || name.length > 40) {
    return { ok: false as const, error: '大会名は1〜40文字で入力してください' };
  }
  if (!Number.isInteger(fee) || fee < 100 || fee > 100000 || fee % 100 !== 0) {
    return { ok: false as const, error: '参加費は100〜100,000ptの100pt単位です' };
  }
  if (![1, 7, 14].includes(days)) {
    return { ok: false as const, error: '期間は1日・1週間・2週間から選んでください' };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('create_tournament', {
    p_name: name,
    p_entry_fee: fee,
    p_days: days,
    p_scope: scope,
    p_announcement: announcement,
  });
  if (error) return { ok: false as const, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  revalidatePath('/tournaments');
  return { ok: true as const, id: row?.id as string, code: row?.invite_code as string };
}

export async function joinTournament(formData: FormData) {
  const code = String(formData.get('code') ?? '').trim();
  if (code.length < 4) return { ok: false as const, error: '招待コードを入力してください' };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('join_tournament', { p_code: code });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/tournaments');
  return { ok: true as const, id: data as string };
}

export async function setTournamentRace(formData: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('set_tournament_race', {
    p_tournament_id: String(formData.get('tournamentId') ?? ''),
    p_event_id: String(formData.get('eventId') ?? ''),
    p_add: formData.get('add') === '1',
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/tournaments/${formData.get('tournamentId')}`);
  return { ok: true as const };
}

/**
 * 景品を決める（主催者だけ）。
 *
 * サイトは景品を表示するだけで、用意も受け渡しもしない。
 * 現金・ギフト券・換金できるものはここで弾く。
 * 画面でも同じチェックをしているが、画面のチェックは迂回できるので
 * 保存の直前にもう一度見る。
 */
export async function setTournamentPrizes(formData: FormData) {
  const prizes = [1, 2, 3].map((n) =>
    String(formData.get(`prize${n}`) ?? '')
      .trim()
      .slice(0, PRIZE_MAX_LENGTH),
  );

  for (const p of prizes) {
    const bad = p ? findMoneyWord(p) : null;
    if (bad) {
      return {
        ok: false as const,
        error:
          `「${bad}」は景品にできません。` +
          `現金・ギフト券・換金できるものは扱えない決まりです。`,
      };
    }
  }

  // 景品を書くなら、全額自己負担の誓約に同意していないと保存できない。
  // 同意した文面はサーバー側の定数を使う。画面から送られた文面は信用しない。
  const agreed = formData.get('agreed') === '1';
  if (prizes.some((p) => p) && !agreed) {
    return {
      ok: false as const,
      error: '景品を決めるには、全額を自分で負担することへの同意が必要です',
    };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('set_tournament_prizes', {
    p_tournament_id: String(formData.get('tournamentId') ?? ''),
    p_1: prizes[0],
    p_2: prizes[1],
    p_3: prizes[2],
    p_agreed: agreed,
    p_pledge_text: PRIZE_PLEDGE_TEXT,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/tournaments/${formData.get('tournamentId')}`);
  return { ok: true as const };
}

export async function setTournamentAnnouncement(formData: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('set_tournament_announcement', {
    p_tournament_id: String(formData.get('tournamentId') ?? ''),
    p_text: String(formData.get('text') ?? ''),
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/tournaments/${formData.get('tournamentId')}`);
  return { ok: true as const };
}
