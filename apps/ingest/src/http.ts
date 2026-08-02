/**
 * 外部サイトへのHTTPアクセス。
 *
 * boatrace.jp のサイトポリシーは「大量の情報送受信及び大量のアクセスなど、
 * 本サイトの運営に支障を与える行為」を禁止している。
 * robots.txt は全許可だが、以下を必ず守る。
 *
 *   - 同時接続は1本のみ（キューで直列化）
 *   - リクエスト間隔は最低 REQUEST_INTERVAL_MS
 *   - User-Agent にサービス名と連絡先を明記
 *   - 連続エラーでサーキットブレーカが開き、自動停止する
 */

const USER_AGENT =
  process.env.INGEST_USER_AGENT ??
  'NoMoneyBoat/0.1 (hobby fan site; +https://example.com/about)';

/** リクエスト間隔。1.2秒 = 秒間1リクエスト未満。 */
const REQUEST_INTERVAL_MS = Number(process.env.INGEST_INTERVAL_MS ?? 1200);

/** 連続でこの回数失敗したら止まる */
const CIRCUIT_THRESHOLD = 5;

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

export class CircuitOpenError extends Error {
  constructor() {
    super('連続エラーのため取得を停止しました（サーキットブレーカ）');
    this.name = 'CircuitOpenError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * HTMLを1本取得する。すべての外部アクセスはこの関数を通す。
 * 呼び出しはキューで直列化されるため、並行に呼んでも同時接続は1本。
 */
export function fetchHtml(url: string): Promise<string> {
  const run = async (): Promise<string> => {
    if (Date.now() < circuitOpenUntil) throw new CircuitOpenError();

    const wait = REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja',
        },
        redirect: 'follow',
      });
      lastRequestAt = Date.now();

      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

      const html = await res.text();
      consecutiveFailures = 0;
      return html;
    } catch (err) {
      lastRequestAt = Date.now();
      consecutiveFailures += 1;
      if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
        circuitOpenUntil = Date.now() + 10 * 60 * 1000; // 10分停止
        console.error('[http] サーキットブレーカが開きました。10分間停止します。');
      }
      throw err;
    }
  };

  const result = queue.then(run, run);
  // キューが例外で止まらないようにする
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function resetCircuit(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}
