/**
 * ボートレース場マスタ。
 * 公式サイトの場コード（jcd）と一致させている。全24場。
 */

export interface Venue {
  /** 公式サイトの jcd。'01'〜'24' */
  code: string;
  name: string;
  /** 地区（表示のグルーピング用） */
  area: string;
}

export const BOATRACE_VENUES: Venue[] = [
  { code: '01', name: '桐生',     area: '関東' },
  { code: '02', name: '戸田',     area: '関東' },
  { code: '03', name: '江戸川',   area: '関東' },
  { code: '04', name: '平和島',   area: '関東' },
  { code: '05', name: '多摩川',   area: '関東' },
  { code: '06', name: '浜名湖',   area: '東海' },
  { code: '07', name: '蒲郡',     area: '東海' },
  { code: '08', name: '常滑',     area: '東海' },
  { code: '09', name: '津',       area: '東海' },
  { code: '10', name: '三国',     area: '近畿' },
  { code: '11', name: 'びわこ',   area: '近畿' },
  { code: '12', name: '住之江',   area: '近畿' },
  { code: '13', name: '尼崎',     area: '近畿' },
  { code: '14', name: '鳴門',     area: '四国' },
  { code: '15', name: '丸亀',     area: '四国' },
  { code: '16', name: '児島',     area: '中国' },
  { code: '17', name: '宮島',     area: '中国' },
  { code: '18', name: '徳山',     area: '中国' },
  { code: '19', name: '下関',     area: '中国' },
  { code: '20', name: '若松',     area: '九州' },
  { code: '21', name: '芦屋',     area: '九州' },
  { code: '22', name: '福岡',     area: '九州' },
  { code: '23', name: '唐津',     area: '九州' },
  { code: '24', name: '大村',     area: '九州' },
];

const BY_CODE = new Map(BOATRACE_VENUES.map((v) => [v.code, v]));

export function venueName(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}

export function findVenueByName(name: string): Venue | undefined {
  return BOATRACE_VENUES.find((v) => v.name === name);
}

/** 'boatrace:20260801:11:12' 形式のイベントキーを作る */
export function boatraceEventKey(dateYmd: string, venueCode: string, raceNo: number): string {
  return `boatrace:${dateYmd}:${venueCode}:${String(raceNo).padStart(2, '0')}`;
}

export function parseBoatraceEventKey(key: string): {
  dateYmd: string;
  venueCode: string;
  raceNo: number;
} {
  const m = /^boatrace:(\d{8}):(\d{2}):(\d{2})$/.exec(key);
  if (!m) throw new Error(`invalid boatrace event key: ${key}`);
  return { dateYmd: m[1]!, venueCode: m[2]!, raceNo: Number(m[3]) };
}
