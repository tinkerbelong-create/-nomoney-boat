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
// 部屋
// =====================================================================

export async function createRoom(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 1 || name.length > 30) {
    return { ok: false as const, error: '部屋の名前は1〜30文字で入力してください' };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('create_room', { p_name: name });
  if (error) return { ok: false as const, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  revalidatePath('/rooms');
  return { ok: true as const, roomId: row?.id as string, code: row?.invite_code as string };
}

export async function joinRoom(formData: FormData) {
  const code = String(formData.get('code') ?? '').trim();
  if (code.length < 4) {
    return { ok: false as const, error: '招待コードを入力してください' };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('join_room', { p_code: code });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/rooms');
  return { ok: true as const, roomId: data as string };
}

export async function leaveRoom(formData: FormData) {
  const roomId = String(formData.get('roomId') ?? '');
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('leave_room', { p_room_id: roomId });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/rooms');
  return { ok: true as const };
}

export async function postRoomMessage(formData: FormData) {
  const roomId = String(formData.get('roomId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (body.length === 0) return { ok: false as const, error: '' };
  if (body.length > 500) {
    return { ok: false as const, error: '500文字までです' };
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'ログインしてください' };

  const { error } = await supabase
    .from('room_messages')
    .insert({ room_id: roomId, user_id: user.id, body });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/rooms/${roomId}`);
  return { ok: true as const };
}
