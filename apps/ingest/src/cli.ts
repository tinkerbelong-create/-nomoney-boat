#!/usr/bin/env node
/**
 * ingest ワーカーの入口。
 *
 *   npm run ingest -- schedule            当日+翌日の開催とレースを取り込む
 *   npm run ingest -- schedule 20260801   日付を指定
 *   npm run ingest -- entrants            出走表を取り込む
 *   npm run ingest -- close               締切を過ぎたマーケットを閉じる
 *   npm run ingest -- settle              結果を取得して精算する
 *   npm run ingest -- weekly              毎週木曜のポイント付与（木曜以外は何もしない）
 *   npm run ingest -- backfill-creatures  過去の的中をさかのぼって生き物を配る（1回だけ）
 *   npm run ingest -- grant 2026-08       旧・月初のポイント付与（0014 以降は未使用）
 *   npm run ingest -- loop                常駐して全部まわす
 *   npm run ingest -- dry-run 20260801    DBに書かずに取得内容を表示（動作確認用）
 */

import {
  syncSchedule,
  syncEntrants,
  syncEntrantDetails,
  closeExpiredMarkets,
  todayYmd,
  getAdapter,
} from './jobs/sync.ts';
import { settleDueEvents, settleOldEvents } from './jobs/settle.ts';
import { pickDailyFeature } from './jobs/feature.ts';
import { db } from './db.ts';

const [, , command, arg] = process.argv;

async function main() {
  switch (command) {
    case 'schedule': {
      const dates = arg ? [arg] : [todayYmd(0), todayYmd(1)];
      for (const d of dates) await syncSchedule(d);
      break;
    }

    case 'entrants': {
      const dates = arg ? [arg] : [todayYmd(0), todayYmd(1)];
      for (const d of dates) await syncEntrants(d);
      break;
    }

    // 取り込み済みのぶんも取り直す。読み取りの不具合を直したときに使う。
    case 'entrants-force': {
      const dates = arg ? [arg] : [todayYmd(0), todayYmd(1)];
      for (const d of dates) await syncEntrants(d, 'boatrace', true);
      break;
    }

    // 締切が近い順に、出走表の詳細（勝率など）を少しずつ埋める
    case 'details':
      await syncEntrantDetails(arg ? Number(arg) : 15);
      break;

    // 今日のお題レースを決める
    case 'feature':
      await pickDailyFeature(arg || undefined);
      break;

    // 【旧機能】大会。画面はすでに撤去した（docs/aquarium-design.md §4）。
    // DBのテーブルは残してあるので、撤去前に始まっていた大会を
    // 最後まで終わらせて大会ポイントを持ちポイントに戻すためだけに残す。
    // 未精算の大会が無くなったら、このコマンドごと消してよい。
    case 'tournaments': {
      const { data, error } = await db().rpc('advance_tournaments');
      if (error) throw error;
      console.log(`[tournaments] ${data} 人ぶん精算しました`);
      break;
    }

    // 過去の的中をさかのぼって生き物を配る。水槽を入れた直後に一度だけ叩く。
    // 何度実行しても、すでに引いたレースは飛ばすので安全。
    case 'backfill-creatures': {
      const { data, error } = await db().rpc('backfill_creatures', { p_user_id: null });
      if (error) throw error;
      console.log(`[creature] 過去のレース ${data} 件ぶんを配りました`);
      break;
    }

    case 'close':
      await closeExpiredMarkets();
      break;

    case 'settle':
      await settleDueEvents();
      break;

    case 'settle-old':
      await settleOldEvents();
      break;

    // 毎週木曜日に5,000ptを配る。木曜以外の日は何も起きない。
    case 'weekly': {
      const { data, error } = await db().rpc('grant_weekly_points');
      if (error) throw error;
      console.log(`[weekly] ${data} 人に付与`);
      break;
    }

    // 月間タイトルを発行する（月末の締め。前月を指定して実行）
    case 'titles': {
      const season = arg ?? lastSeasonCode();
      const { data, error } = await db().rpc('award_monthly_titles', {
        p_season_code: season,
      });
      if (error) throw error;
      console.log(`[titles] ${season}: 称号 ${data} 件`);
      break;
    }

    case 'loop':
      await loop();
      break;

    case 'dry-run':
      await dryRun(arg ?? todayYmd(0));
      break;

    default:
      console.log(`使い方:
  schedule [YYYYMMDD]   開催スケジュールとマーケットを取り込む
  entrants [YYYYMMDD]   出走表を取り込む
  entrants-force [YYYYMMDD] 取り込み済みのぶんも取り直す
  details [件数]        締切が近い順に出走表の詳細を埋める
  feature [YYYY-MM-DD] 今日のお題レースを決める
  close                 締切を過ぎたマーケットを閉じる
  settle                結果を取得して精算する
  settle-old            12時間以上前の取り残しを処理する
  weekly                毎週木曜のポイント付与（木曜以外は何もしない）
  backfill-creatures    過去の的中をさかのぼって生き物を配る（初回だけ）
  titles [YYYY-MM]      月間タイトルを発行する
  tournaments           【旧】残っている大会を終わらせる（画面は撤去済み）
  loop                  常駐して全部まわす
  dry-run [YYYYMMDD]    DBに書かずに取得内容だけ表示する`);
      process.exit(1);
  }
}

/**
 * 常駐モード。
 * 1分ごとに締切処理、5分ごとに結果ポーリング、1時間ごとにスケジュール更新。
 */
async function loop() {
  console.log('[loop] 開始');
  let tick = 0;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[loop] ${label} でエラー:`, err);
    }
  };

  await run('schedule', () => syncSchedule(todayYmd(0)));
  await run('entrants', () => syncEntrants(todayYmd(0)));

  for (;;) {
    tick += 1;
    await run('close', closeExpiredMarkets);

    if (tick % 5 === 0) await run('settle', () => settleDueEvents());

    if (tick % 60 === 0) {
      for (const d of [todayYmd(0), todayYmd(1)]) {
        await run('schedule', () => syncSchedule(d));
        await run('entrants', () => syncEntrants(d));
      }
    }

    // 1日1回、取り残したレースを回収する
    if (tick % 720 === 0) await run('settle-old', () => settleOldEvents());

    await sleep(60_000);
  }
}

/**
 * DBに一切書かず、公式サイトから何が取れるかだけを表示する。
 * 初回セットアップ時や、公式サイトの構造が変わったときの確認用。
 */
async function dryRun(dateYmd: string) {
  const adapter = getAdapter('boatrace');

  console.log(`\n=== ${dateYmd} の開催 ===`);
  const events = await adapter.fetchSchedule(dateYmd);
  console.log(`${events.length} レース取得\n`);

  for (const e of events.slice(0, 5)) {
    console.log(
      `  ${e.venueName} ${e.raceNumber}R  締切 ${e.deadlineAt.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      })}  ${e.title}`,
    );
  }
  if (events.length > 5) console.log(`  ... ほか ${events.length - 5} レース`);

  if (events.length === 0) return;

  const first = events[0]!;
  console.log(`\n=== 出走表: ${first.venueName} ${first.raceNumber}R ===`);
  const entrants = await adapter.fetchEntrants(first.externalKey);
  for (const en of entrants) {
    console.log(`  ${en.numberLabel} ${en.name}  ${JSON.stringify(en.meta)}`);
  }
  if (entrants.length === 0) console.log('  ※ 取得できませんでした。パーサの確認が必要です。');

  console.log(`\n=== 結果: ${first.venueName} ${first.raceNumber}R ===`);
  const result = await adapter.fetchResult(first.externalKey);
  if (!result) {
    console.log('  まだ確定していません');
  } else if (result.status === 'cancelled') {
    console.log('  中止');
  } else {
    for (const p of result.placings) console.log(`  ${p.rank}着 ${p.slot}号艇 ${p.name}`);
    console.log('');
    for (const m of result.markets) {
      for (const p of m.payouts) {
        console.log(
          `  ${m.betTypeCode.padEnd(9)} ${p.selection.padEnd(7)} ${p.payoutPer100}pt/100pt` +
            (p.popularity ? `  ${p.popularity}番人気` : ''),
        );
      }
    }
    if (result.refunded.length > 0) console.log(`  返還: ${result.refunded.join(', ')}`);
  }
}

/** 先月のシーズンコード。月間タイトルは月が変わってから発行する。 */
function lastSeasonCode(): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  jst.setUTCDate(1);
  jst.setUTCMonth(jst.getUTCMonth() - 1);
  return jst.toISOString().slice(0, 7);
}

function currentSeasonCode(): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 7);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
