/**
 * 運用まわりの設定値。
 *
 * 結果の反映は裏で動くワーカーの実行間隔に依存する。
 * 利用者から見ると「レースは終わったのにポイントが増えない」状態が
 * しばらく続くので、待ち時間をあらかじめ画面に出しておく。
 *
 * GitHub Actions の実行間隔を変えたら、ここも合わせて変えること。
 * 環境変数 NEXT_PUBLIC_SETTLE_DELAY_MIN で上書きできる。
 */

export const SETTLE_DELAY_MIN = Number(
  process.env.NEXT_PUBLIC_SETTLE_DELAY_MIN ?? 15,
);

/** 「最大15分ほどかかります」のような文言 */
export const settleDelayText = `結果の反映まで最大${SETTLE_DELAY_MIN}分ほどかかります`;

/** 締切直後に出す短い案内 */
export const settleWaitingText = `レース確定後、最大${SETTLE_DELAY_MIN}分でポイントに反映されます`;
