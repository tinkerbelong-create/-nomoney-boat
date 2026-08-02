/**
 * アダプタ層のインターフェース。
 *
 * 今はボートレースのみ実装している。
 * 将来ほかの競技を足すときは、このインターフェースを実装したクラスを
 * 追加して registry に登録するだけで、ジョブ側のコードは変更不要。
 */

export interface EventDraft {
  externalKey: string;
  title: string;
  venueCode: string;
  venueName: string;
  raceNumber: number;
  grade?: string;
  scheduledAt: Date;
  /** 締切時刻。投票可否の唯一の判断基準になる。 */
  deadlineAt: Date;
  status: 'scheduled' | 'cancelled';
  meta?: Record<string, unknown>;
  /** このイベントで開く賭け式 */
  betTypeCodes: string[];
}

export interface EntrantDraft {
  slotCode: string;
  numberLabel: string;
  name: string;
  meta: Record<string, unknown>;
  sortOrder: number;
}

export interface PayoutDraft {
  selection: string;
  payoutPer100: number;
  popularity?: number;
}

export interface MarketResultDraft {
  betTypeCode: string;
  payouts: PayoutDraft[];
}

export interface ResultDraft {
  status: 'resolved' | 'cancelled';
  markets: MarketResultDraft[];
  placings: { rank: number; slot: string; name: string; time?: string }[];
  /** 返還対象の艇番。これを含む買い目は返還になる。 */
  refunded: string[];
  weather: Record<string, unknown>;
  decidedBy?: string;
}

export interface SportAdapter {
  readonly sportCode: string;
  /** 指定日の開催イベント一覧 */
  fetchSchedule(dateYmd: string): Promise<EventDraft[]>;
  /** 出走表 */
  fetchEntrants(externalKey: string): Promise<EntrantDraft[]>;
  /** 未確定なら null */
  fetchResult(externalKey: string): Promise<ResultDraft | null>;
}
