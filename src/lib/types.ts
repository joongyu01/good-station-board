import type { BrandCode } from "./brand.ts";
import type { Compliance } from "./history.ts";

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

/** 판정 기준 — 휘발유+경유 합산, 또는 한 유종만. */
export type ViewMode = "sum" | "gasoline" | "diesel";

export const VIEW_MODES: ViewMode[] = ["sum", "gasoline", "diesel"];

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  sum: "통합",
  gasoline: "휘발유",
  diesel: "경유",
};

/**
 * 한 기준(합산/휘발유/경유)에서 본 주유소 1곳의 성적.
 *
 * 세 기준을 미리 다 계산해 싣는다. 화면에서 기준을 바꿀 때마다 전국 분포를
 * 다시 세울 수는 없기 때문이다.
 */
export interface FuelMetric {
  /** 판매가. 합산 기준이면 휘발유+경유 합계 */
  price: number | null;
  /** 시·도 내 순위 (1 = 최저). 신호등은 이 값으로 정한다 */
  regionRank: number | null;
  /** 그 시·도에서 이 기준으로 비교 가능한 주유소 수 */
  regionN: number;
  /** 그 시·도의 실제 최저값 */
  regionMin: number | null;
  /** 그 시·도의 평균 */
  regionMean: number | null;
  /** 상위권 커트라인 — 계수 1.000 이 되는 값 */
  greenBase: number | null;
  /** price / greenBase. 1.000 이하가 상위권 */
  coefficient: number | null;
  /** 지역 최저와의 차 (원/L) */
  gapFromMin: number | null;
  isRegionLowest: boolean;
  signal: SignalColor;
}

/**
 * 착한주유소 **1곳**의 판정 결과.
 *
 * 유종별로 신호등을 따로 매기지 않는다 — 기본은 휘발유+경유를 합친 하나다.
 * 다만 화면에서 기준을 바꿔 볼 수 있게 세 기준(합산/휘발유/경유)의 성적을
 * `metrics` 에 모두 싣는다. 최상위 필드는 그중 합산 기준을 펼쳐 둔 것이다.
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
  /** 세 기준의 성적. 화면이 고른 기준을 꺼내 쓴다. */
  metrics: Record<ViewMode, FuelMetric>;

  // ── 아래는 metrics.sum 을 펼쳐 둔 값이다. 기본 화면이 합산 기준이라
  //    매번 metrics.sum 을 거치지 않도록 남겨 둔다. ──
  /** 휘발유+경유 합계. 둘 중 하나라도 없으면 null */
  sum: number | null;
  /** 합산 가격지수 */
  priceIndex: PriceIndex | null;
  regionMinSum: number | null;
  regionMeanSum: number | null;
  gapFromMin: number | null;
  regionRank: number | null;
  regionN: number;
  /** 초록 기준 순위. 화면에 "10위 이내" 처럼 근거를 보여주는 데 쓴다 */
  greenRank: number;
  isRegionLowest: boolean;
  signal: SignalColor;

  /**
   * 시계열에서 가격이 비었거나 0원이었던 날 수.
   *
   * 0보다 크면 판정을 붙이지 않고 '가격정보 없음' 으로 뺀다. 그날 값만 보고
   * 판정하면 "어제는 1위, 오늘은 미상" 처럼 오락가락하는데, 신고를 거른 이력이
   * 있는 곳은 그 값을 믿고 순위를 매기기 어렵다는 뜻이라 확인 대상으로 둔다.
   */
  dataGapDays: number;

  /**
   * 기본 구간(8월 1일 ~ 최신일) 동안 며칠이나 기준 안에 들어왔는지.
   *
   * 하루치 신호등은 그날 사정에 따라 흔들린다. 이 값은 한 달치 성적이라
   * 그 주유소가 꾸준했는지를 보여준다.
   */
  compliance: Compliance;
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
