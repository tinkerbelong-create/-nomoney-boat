/**
 * 精算パイプライン。
 *
 *   ① 結果を取得して確定していれば market_results に払戻率を入れる
 *   ② 的中判定（selection の完全一致）
 *   ③ 外れ確定
 *   ④ ポイント台帳へ計上
 *   ⑤ マーケットを settled にする
 *
 * ②〜⑤ に賭け式による分岐は一切ない。
 * ①だけが競技・払戻方式ごとに違う。
 *
 * 何度実行しても結果が変わらないよう作ってある。
 * 台帳の二重計上は point_ledger の部分一意インデックスが最終防衛線。
 */

import { settleEvent as settleEventCore } from '../../../web/src/core/settle.ts';
import { db } from '../db.ts';
import { getAdapter, refundEvent } from './sync.ts';

/**
 * 締切済みで未確定のレースを拾い、結果が出ていれば精算する。
 * 対象を絞ることで外部サイトへのアクセスを必要最小限にしている。
 */
export async function settleDueEvents(sportCode = 'boatrace', limit = 40) {
  const supabase = db();

  // 直近12時間以内に締め切ったレースだけを対象にする。
  //
  // これがないと、何らかの理由で結果を取得できなかった古いレースが
  // 'closed' のまま溜まり続け、締切の古い順に40件で頭打ちになって
  // 「新しいレースがいつまでも精算されない」という詰まり方をする。
  // 取り残された古いレースは settle-old コマンドで個別に処理する。
  const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from('events')
    .select('id, external_key, title')
    .eq('sport_code', sportCode)
    .eq('status', 'closed')
    .gte('deadline_at', since)
    .order('deadline_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  // 取り残しの監視。放置すると投票したポイントが宙に浮いたままになる。
  const { count: staleCount } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('sport_code', sportCode)
    .eq('status', 'closed')
    .lt('deadline_at', since);

  if (staleCount && staleCount > 0) {
    console.warn(
      `[settle] 12時間以上前の未精算レースが ${staleCount} 件あります。` +
        `'npm run ingest -- settle-old' で処理してください。`,
    );
  }

  if (!events || events.length === 0) {
    console.log('[settle] 精算対象なし');
    return 0;
  }

  const adapter = getAdapter(sportCode);
  let settled = 0;

  for (const ev of events) {
    try {
      const result = await adapter.fetchResult(ev.external_key);
      if (!result) continue; // まだ確定していない

      if (result.status === 'cancelled') {
        await refundEvent(ev.id, 'レース中止');
        await supabase.from('events').update({ status: 'cancelled' }).eq('id', ev.id);
        settled += 1;
        continue;
      }

      await settleEventCore(db(), ev.id, result as any);
      settled += 1;
      console.log(`[settle] ${ev.title} を精算しました`);
    } catch (err) {
      console.error(`[settle] ${ev.external_key} 失敗:`, err);
    }
  }

  if (settled > 0) await refreshStats();
  return settled;
}

/**
 * 12時間以上前に締め切ったのに精算されていないレースを処理する。
 *
 * 公式サイトの構造変更やネットワーク障害で取りこぼしたぶんの回収用。
 * 結果ページがすでに消えていて取得できない場合は、投票を全額返還して
 * 決着をつける。ポイントを宙に浮かせたままにしないことを優先する。
 */
export async function settleOldEvents(sportCode = 'boatrace', limit = 20) {
  const supabase = db();
  const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();

  const { data: events } = await supabase
    .from('events')
    .select('id, external_key, title')
    .eq('sport_code', sportCode)
    .eq('status', 'closed')
    .lt('deadline_at', since)
    .order('deadline_at', { ascending: true })
    .limit(limit);

  if (!events || events.length === 0) {
    console.log('[settle-old] 取り残しはありません');
    return 0;
  }

  const adapter = getAdapter(sportCode);
  let done = 0;

  for (const ev of events) {
    try {
      const result = await adapter.fetchResult(ev.external_key);

      if (!result || result.status === 'cancelled') {
        // 結果が取れないまま12時間経っている。返還して決着させる。
        await refundEvent(ev.id, '結果を取得できなかったため返還');
        await supabase.from('events').update({ status: 'cancelled' }).eq('id', ev.id);
        console.warn(`[settle-old] ${ev.title}: 結果が取れないため全額返還しました`);
      } else {
        await settleEventCore(db(), ev.id, result as any);
        console.log(`[settle-old] ${ev.title} を精算しました`);
      }
      done += 1;
    } catch (err) {
      console.error(`[settle-old] ${ev.external_key} 失敗:`, err);
    }
  }

  if (done > 0) await refreshStats();
  return done;
}

/** ランキング用の集計を作り直す */
export async function refreshStats() {
  const supabase = db();
  const { error } = await supabase.rpc('refresh_user_season_stats');
  if (error) console.warn('[settle] 集計の更新に失敗:', error.message);
}
