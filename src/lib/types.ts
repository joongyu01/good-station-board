/** 유종. Opinet 다운로드 CSV가 제공하는 4종. */
export type FuelType = "gasoline" | "diesel" | "kerosene" | "premiumGasoline";

export const FUEL_TYPES: FuelType[] = ["gasoline", "diesel", "kerosene", "premiumGasoline"];

export const FUEL_LABELS: Record<FuelType, string> = {
  gasoline: "휘발유",
  diesel: "경유",
  kerosene: "실내등유",
  premiumGasoline: "고급휘발유",
};

/** 착한주유소 명단 1건 (adress.csv 정규화 결과) */
export interface GoodStation {
  /** 명단 내 고유번호. 상호가 중복되므로 이름을 키로 쓰면 안 된다. */
  seq: number;
  name: string;
  address: string;
  sido: string;
  sigungu: string;
  sigunguDetail: string;
  regionKey: string;
  /** Opinet 주유소 코드. 매칭 전에는 null. */
  stationId: string | null;
  /** 매칭 근거 — auto(주소) / auto(상호+지역) / manual / unmatched */
  matchMethod?: string;
  matchScore?: number;
  /** 정규화 중 보정한 비표준 표기 */
  anomaly?: string;
}

/** Opinet 전국 CSV 1행 */
export interface StationPriceRow {
  stationId: string;
  stationName: string;
  address: string;
  region: string;
  sido: string;
  date: string;
  brand: string;
  isSelf: boolean;
  premiumGasoline: number | null;
  gasoline: number | null;
  diesel: number | null;
  kerosene: number | null;
}

/** 시군구 × 유종 단위 가격 분포 통계 */
export interface RegionStat {
  regionKey: string;
  sido: string;
  sigungu: string;
  fuelType: FuelType;
  /** 표본 수 (해당 유종 가격이 있는 주유소 수) */
  n: number;
  mean: number;
  /** 표본표준편차 (n-1). n<2면 0 */
  stdev: number;
  min: number;
  max: number;
  /** 표본 부족으로 시·도 통계를 대신 쓴 경우 true */
  fallback: boolean;
  /** fallback일 때 실제로 사용한 모집단 키 */
  basisKey: string;
}

export type SignalColor = "green" | "yellow" | "red" | "unknown";

/** 착한주유소 1곳 × 1유종 판정 결과 */
export interface StationSignal {
  seq: number;
  stationId: string | null;
  name: string;
  sido: string;
  sigungu: string;
  regionKey: string;
  /**
   * 일반구 이름 (예: "마산합포구"). 일반구를 둔 시가 아니면 null.
   *
   * 오피넷은 시 단위까지만 주므로 명단 주소에서 가져온다. 집계(μ/σ)는 시 단위로
   * 하고 이 값은 지도 드릴다운 한 단계를 더 내려가는 데만 쓴다.
   */
  district: string | null;
  lat: number | null;
  lng: number | null;
  fuelType: FuelType;
  price: number | null;
  /** 시군구 평균 */
  regionMean: number | null;
  /** 시군구 최저가 — 신호등 판정의 기준선 */
  regionMin: number | null;
  /** 지역 최저가와의 차이 (원/L). 0이면 최저가. 신호등은 이 값으로 정한다 */
  gapFromMin: number | null;
  /** 평균 대비 편차 (원/L). 음수면 평균보다 쌈. 참고용 */
  diff: number | null;
  zScore: number | null;
  signal: SignalColor;
  /** 시군구 내 최저가면 true */
  isRegionLowest: boolean;
  /** 시군구 내 순위 (1 = 최저가) */
  regionRank: number | null;
  regionN: number;
  /** 표본 부족으로 시·도 σ를 대신 쓴 경우 */
  lowSample: boolean;
}

/** 현황판이 읽는 최종 산출물 */
export interface BoardData {
  /** 가격 기준일 YYYYMMDD */
  date: string;
  generatedAt: string;
  stations: StationSignal[];
  regions: RegionStat[];
  summary: {
    total: number;
    matched: number;
    byFuel: Record<string, { green: number; yellow: number; red: number; unknown: number }>;
  };
}
