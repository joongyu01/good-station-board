import type { BrandCode } from "./brand.ts";

/** Opinet 다운로드 CSV가 제공하는 유종. 파싱은 4종 모두 한다. */
export type FuelType = "gasoline" | "diesel" | "kerosene" | "premiumGasoline";

/**
 * 현황판이 다루는 유종 — **휘발유와 경유만**.
 *
 * 실내등유와 고급휘발유는 뺐다. 취급하지 않는 주유소가 대부분이라
 * (449곳 중 각각 297곳·341곳이 미취급) 판정이 '미상'으로 가득 차고,
 * 착한주유소 제도의 관심 대상도 아니다.
 */
export const FUEL_TYPES: FuelType[] = ["gasoline", "diesel"];

export const FUEL_LABELS: Record<FuelType, string> = {
  gasoline: "휘발유",
  diesel: "경유",
  kerosene: "실내등유",
  premiumGasoline: "고급휘발유",
};

/** 통계 단위 — 유종별, 그리고 휘발유+경유 합계. */
export type StatKind = FuelType | "sum";

/** 착한주유소 명단 1건 (명단 CSV 정규화 결과) */
export interface GoodStation {
  /** 명단 내 고유번호. 상호가 중복되므로 이름을 키로 쓰면 안 된다. */
  seq: number;
  name: string;
  address: string;
  sido: string;
  sigungu: string;
  sigunguDetail: string;
  regionKey: string;
  /**
   * Opinet 주유소 코드.
   *
   * 명단 CSV 의 `번호` 열에 이미 들어 있다. 비어 있는 행만 매칭 단계가 채운다.
   */
  stationId: string | null;
  /** 폴(상표) 코드. 화면에는 `대경주유소(HD)` 처럼 붙는다. */
  brand: BrandCode | null;
  /** 셀프 주유소 여부 */
  isSelf: boolean;
  /** 선정차수 (예: "1차") */
  round: string | null;
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

/** 시·도 × 통계단위 가격 분포 */
export interface RegionStat {
  regionKey: string;
  sido: string;
  sigungu: string;
  /** 유종, 또는 휘발유+경유 합계("sum") */
  fuelType: StatKind;
  /** 표본 수 */
  n: number;
  mean: number;
  /** 표본표준편차 (n-1). n<2면 0 */
  stdev: number;
  min: number;
  max: number;
  /** 표본 부족으로 상위 단위 통계를 대신 쓴 경우 true */
  fallback: boolean;
  /** fallback일 때 실제로 사용한 모집단 키 */
  basisKey: string;
}

export type SignalColor = "green" | "yellow" | "red" | "unknown";

/**
 * 착한주유소 **1곳**의 판정 결과.
 *
 * 유종별로 따로 판정하지 않는다. 점수(계수)가 휘발유+경유를 합친 값이므로
 * 신호등도 주유소 단위로 하나만 나온다. 유종별 판매가는 근거로 함께 싣는다.
 */
export interface StationSignal {
  seq: number;
  stationId: string | null;
  name: string;
  /** 폴(상표) 코드. 화면에는 상호 뒤 괄호로 붙는다. */
  brand: BrandCode | null;
  isSelf: boolean;
  sido: string;
  sigungu: string;
  regionKey: string;
  /**
   * 일반구 이름 (예: "마산합포구"). 일반구를 둔 시가 아니면 null.
   *
   * 오피넷은 시 단위까지만 주므로 명단 주소에서 가져온다. 판정은 시·도 단위로
   * 하고 이 값은 지도 드릴다운 한 단계를 더 내려가는 데만 쓴다.
   */
  district: string | null;
  lat: number | null;
  lng: number | null;
  /** 유종별 판매가 (원/L). 취급하지 않으면 null */
  prices: Record<FuelType, number | null>;
  /** 휘발유+경유 합계. 둘 중 하나라도 없으면 null */
  sum: number | null;
  /** 합산 가격지수. 신호등의 근거다. */
  priceIndex: PriceIndex | null;
  /** 그 시·도에서 실제로 가장 싼 합계 */
  regionMinSum: number | null;
  /** 그 시·도의 평균 합계 */
  regionMeanSum: number | null;
  /** 지역 최저 합계와의 차 (원/L) */
  gapFromMin: number | null;
  /**
   * 시·도 내 합계 순위 (1 = 최저). **신호등은 이 값으로 정한다.**
   * 서울·경기는 10위 이내, 그 밖의 시·도는 5위 이내가 초록.
   */
  regionRank: number | null;
  /** 그 시·도에서 휘발유·경유를 **모두** 파는 주유소 수 */
  regionN: number;
  /** 초록 기준 순위. 화면에 "10위 이내" 처럼 근거를 보여주는 데 쓴다 */
  greenRank: number;
  /** 시·도 내 합계 최저면 true */
  isRegionLowest: boolean;
  signal: SignalColor;
}

/**
 * 휘발유+경유 합산 계수.
 *
 * 그 시·도의 **초록불 커트라인**(서울·경기 10위, 그 밖 5위 자리의 합계)을
 * 1.000 으로 두고 각 주유소의 합계를 비례 환산한다.
 *   예) 경기 10위 합계 3,600원 → 계수 1.000
 *       어느 주유소 3,528원      → 계수 0.980  (상위권)
 *       어느 주유소 3,744원      → 계수 1.040  (미달)
 *
 * 1.000 이 합격선이라 계수만 보고 판정 근거를 읽을 수 있다.
 */
export interface PriceIndex {
  /** 휘발유 + 경유 합계 (원/L) */
  sum: number;
  /** 그 시·도의 초록불 커트라인 합계 */
  regionBase: number;
  /** sum / regionBase. 1.000 이하면 상위권 */
  coefficient: number;
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
    /** 주유소 단위 신호등 집계 */
    counts: { green: number; yellow: number; red: number; unknown: number };
  };
}
