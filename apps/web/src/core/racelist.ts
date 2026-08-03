/**
 * 出走表ページ（racelist）の解析。
 *
 * 取り込みワーカーと Web の両方から使う。
 * Web 側では「利用者がそのレースを開いたとき」に呼んで、
 * 勝率・当地成績・モーターといった予想用の数字をその場で埋める。
 *
 * cheerio を使うのでサーバー専用。core/index.ts からは再輸出しないこと。
 */

import * as cheerio from 'cheerio';

export interface RacelistEntrant {
  slotCode: string;
  numberLabel: string;
  name: string;
  meta: Record<string, unknown>;
  sortOrder: number;
}

type EntrantDraft = RacelistEntrant;

function cleanText(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseEntrants(html: string, externalKey: string): EntrantDraft[] {
  const $ = cheerio.load(html);

  if (/データがありません/.test($('body').text())) return [];

  const entrants: EntrantDraft[] = [];

    // 出走表は「1艇 = 1 tbody」の構造。
    //
    // 1行目のセルの並びは次のとおり（2行目以降は rowspan で省略される）。
    //   枠 / 写真 / 登録番号・級別・氏名・支部・年齢体重 / F数・L数・平均ST /
    //   全国(勝率・2連率・3連率) / 当地(同) / モーター(No・2連率・3連率) /
    //   ボート(同) / 今節成績…
    //
    // 「F数 L数 平均ST」のセルを目印にして、そこから右へ数えることで
    // レイアウトが多少変わっても崩れないようにしている。
    $('table tbody').each((_, tbody) => {
      const $tb = $(tbody);
      const text = cleanText($tb.text());
      if (!text) return;

      // 登録番号(4桁) と 級別(A1/A2/B1/B2) が同居する行だけを選手行とみなす
      const regMatch = /(\d{4})\s*\/?\s*(A1|A2|B1|B2)/.exec(text);
      if (!regMatch) return;

      const $tds = $tb.find('tr').first().find('td');
      const tdText = $tds.map((__, td) => cleanText($(td).text())).get();

      // セルの中身は <br> 区切りで数値が縦に3つ並ぶ。
      // テキストをそのまま繋げると「53」と「33.95」が「5333.95」になって
      // 桁が壊れるので、必ず <br> で切ってから読む。
      const parts = (i: number) => splitByBr($tds.eq(i).html());

      // 「F0 / L0 / 平均ST」のセルの位置。
      // ここから +1 が全国、+2 が当地、+3 がモーター、+4 がボート。
      const stIdx = tdText.findIndex((t) => /F\s*\d/.test(t) && /L\s*\d/.test(t));
      const isDec = (s: string) => /^\d+\.\d+$/.test(s);

      let avgSt: string | undefined;
      let national: string[] = [];
      let local: string[] = [];
      let motorCell: string[] = [];
      let boatCell: string[] = [];
      let profile = '';

      if (stIdx >= 0) {
        avgSt = parts(stIdx).filter(isDec).at(-1);
        national = parts(stIdx + 1).filter(isDec);
        local = parts(stIdx + 2).filter(isDec);
        motorCell = parts(stIdx + 3);
        boatCell = parts(stIdx + 4);
        profile = parts(stIdx - 1).join(' ');
      } else {
        // 予備。セルの構造が変わったときは、選手ブロック全体の数値の並びから拾う。
        // 並びは 平均ST → 全国3つ → 当地3つ → モーター2つ → ボート2つ。
        console.warn(`[boatrace] ${externalKey}: 成績欄の位置を特定できませんでした`);
        const all = text.match(/\d+\.\d{2}/g) ?? [];
        avgSt = all[0];
        national = all.slice(1, 4);
        local = all.slice(4, 7);
        motorCell = ['', ...all.slice(7, 9)];
        boatCell = ['', ...all.slice(9, 11)];
        profile = text;
      }

      const motor = motorCell.filter(isDec);
      const boat = boatCell.filter(isDec);

      const place = /([一-龥ヶ]{2,4})\s*\/\s*([一-龥ヶ]{2,4})/.exec(profile);
      const body = /(\d{1,2})歳\s*\/\s*([\d.]+)kg/.exec(profile.replace(/\s+/g, ''));

      entrants.push({
        // 艇番はこの時点では仮。全部読み終わってから確定させる。
        slotCode: detectLaneNumber($, $tb) ?? '',
        numberLabel: '',
        name: extractRacerName($, $tb),
        meta: {
          racerId: regMatch[1],
          racerClass: regMatch[2],
          branch: place?.[1],
          hometown: place?.[2],
          age: body?.[1],
          weight: body?.[2],
          avgSt,
          nationalWin: national[0],
          nationalTop2: national[1],
          nationalTop3: national[2],
          localWin: local[0],
          localTop2: local[1],
          localTop3: local[2],
          motorNo: motorCell.find((s) => /^\d+$/.test(s)),
          motorTop2: motor[0],
          motorTop3: motor[1],
          boatNo: boatCell.find((s) => /^\d+$/.test(s)),
          boatTop2: boat[0],
          boatTop3: boat[1],
          // 旧表示との互換。先頭が全国勝率になるようにしてある。
          rates: [...national, ...local, ...motor, ...boat],
        },
        sortOrder: 0,
      });
    });

    if (entrants.length === 0) {
      console.warn(`[boatrace] ${externalKey}: 出走表を1件も取得できませんでした`);
      return [];
    }

    // 艇番の確定。
    //
    // HTMLから読んだ艇番が「6艇ぶんすべて異なる」ときだけそれを信用する。
    // 重複や欠けがある場合は、公式サイトが必ず1号艇→6号艇の順に並べることを
    // 利用して、出てきた順番で 1,2,3... と振り直す。
    //
    // 以前はここで重複した艇番のまま保存しようとして、
    // データベースに弾かれて出走表がまったく入らなかった。
    const detected = entrants.map((e) => e.slotCode);
    const allValid =
      detected.every((s) => /^[1-6]$/.test(s)) &&
      new Set(detected).size === detected.length;

    if (!allValid) {
      console.warn(
        `[boatrace] ${externalKey}: 艇番を読めなかったので並び順で振り直します ` +
          `(読めた値: ${JSON.stringify(detected)})`,
      );
    }

    const fixed = entrants.map((e, i) => {
      const slot = allValid ? e.slotCode : String(i + 1);
      return {
        ...e,
        slotCode: slot,
        numberLabel: `${slot}号艇`,
        name: e.name || `${slot}号艇`,
        sortOrder: Number(slot),
      };
    });

    // 念のため、それでも重複していたら先勝ちで落とす。
    // 重複があるとデータベースへの書き込み全体が失敗してしまうため。
    const seen = new Set<string>();
    const unique = fixed.filter((e) => {
      if (seen.has(e.slotCode)) return false;
      seen.add(e.slotCode);
      return true;
    });

  return unique.sort((a, b) => a.sortOrder - b.sortOrder);
}


/**
 * セルの中身を <br> で分けて、行ごとの文字列にする。
 *
 * 公式の出走表は1つのセルに「モーターNo / 2連率 / 3連率」を縦に並べている。
 * cheerio の .text() は <br> を無視して繋げてしまうため、
 * 「53」と「33.95」が「5333.95」になり桁が壊れる。
 * HTMLの段階で切ってから中のタグを落とす。
 */
function splitByBr(html: string | null): string[] {
  if (!html) return [];
  return html
    .split(/<br\s*\/?>/i)
    .map((chunk) => cleanText(chunk.replace(/<[^>]*>/g, ' ')))
    .filter((s) => s.length > 0);
}


/** 全角数字を半角に直す */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}


/**
 * 選手ブロックから艇番(1-6)を拾う。
 *
 * 公式サイトの「枠」欄は全角数字（１〜６）で書かれている。
 * 以前は半角しか見ていなかったため艇番をまったく読めず、
 * 代わりに今節成績の数字を拾って6艇とも同じ番号になっていた。
 */
function detectLaneNumber($: cheerio.CheerioAPI, $tb: cheerio.Cheerio<any>): string | null {
  // クラス名 is-boatColor1 などが最も確実
  const cls = $tb.find('[class*="boatColor"]').first().attr('class') ?? '';
  const byClass = /boatColor([1-6])/.exec(cls);
  if (byClass) return byClass[1]!;

  let lane: string | null = null;
  $tb.find('td').each((_, td) => {
    if (lane) return;
    const t = toHalfWidthDigits(cleanText($(td).text()));
    if (/^[1-6]$/.test(t)) lane = t;
  });
  return lane;
}


/**
 * 選手名。
 *
 * 選手ページへのリンクは1つの選手ブロックに2つある。
 * 先に出てくるのは顔写真のリンクで、中身が画像なのでテキストは空。
 * 以前は .first() でこちらを拾ってしまい、名前がずっと空だった。
 * 文字が入っているリンクを選ぶ。
 */
function extractRacerName($: cheerio.CheerioAPI, $tb: cheerio.Cheerio<any>): string {
  let name = '';
  $tb.find('a[href*="racersearch"]').each((_, a) => {
    if (name) return;
    const t = cleanText($(a).text());
    if (t && !/^\d+$/.test(t)) name = t;
  });
  if (name) return name;

  const m = /([一-龥゠-ヿ]{1,5}[\s　]+[一-龥゠-ヿ]{1,5})/.exec(cleanText($tb.text()));
  return m ? m[1]!.replace(/\s+/g, ' ') : '';
}
