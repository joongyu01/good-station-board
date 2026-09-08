import type { AdjustedMetric } from "./adjust.ts";
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

/**
 * 판정 색.
 *
 * `unknown` 과 `stale` 은 둘 다 "가격을 믿고 순위를 매기기 어렵다" 는 뜻이지만
 * 성격이 다르다. unknown 은 **오늘** 가격이 없어 아예 판정을 못 한 것이고,
 * stale 은 오늘은 가격이 있으나 **과거에 거른 이력**이 있는 것이다. 앞의 것은
 * 지금 확인할 일이고 뒤의 것은 신고 이력을 따질 일이라 섞으면 안 된다.
 */
export type SignalColor = "green" | "yellow" | "red" | "unknown" | "stale" | "cancel";

/** 요약·집계에서 쓰는 판정 색 순서. 화면의 띠도 이 차례다. */
export const SIGNAL_ORDER: SignalColor[] = ["green", "yellow", "red", "unknown", "stale", "cancel"];

/** 색깔별 빈 집계표. 색을 하나 늘려도 세는 쪽은 손대지 않게 한 곳에 둔다. */
export function emptyCounts(): Record<SignalColor, number> {
  return { green: 0, yellow: 0, red: 0, unknown: 0, stale: 0, cancel: 0 };
}

/**
 * 선정 취소 대상으로 보는 초과일 비율.
 *
 * 착한주유소로 뽑힌 **뒤에** 그 시·도 평균(휘발유+경유)보다 비싸게 판 날이
 * 절반을 넘으면 대상으로 본다. 하루이틀 넘긴 것까지 걸면 212곳이 잡혀 뜻이
 * 없고(전체의 45%), 늘 넘긴 곳만 세면 11곳이라 너무 좁다. 절반이면 72곳이고
 * 그 72곳은 지금도 전부 빨강이라, 검정으로 덮어도 적합·근접을 가리지 않는다.
 *
 * 이 값은 제도 기준이지 계산의 성질이 아니다. 바꾸려면 여기만 고치면 된다 —
 * 0.3 이면 101곳, 0.8 이면 38곳이다.
 */
export const CANCEL_OVER_RATE = 0.5;

/**
 * 선정 이후 그 시·도 평균을 넘긴 이력.
 *
 * 신호등은 **오늘** 순위를 묻지만 이건 **뽑힌 뒤 줄곧** 어땠는지를 묻는다.
 * 오늘 하루 싸게 판다고 지난 다섯 달이 지워지지는 않으므로 따로 센다.
 */
export interface OverRegion {
  /** 최초 선정 공시일. 이 날 다음날부터 센다 */
  since: string;
  /** 견줄 수 있었던 날 수 (가격과 지역 평균이 모두 있는 날) */
  days: number;
  /** 그중 지역 평균을 넘긴 날 수 */
  overDays: number;
  /** 넘긴 날의 평균 초과액 (원, 휘발유+경유 합계 기준) */
  meanOver: number;
  /** 가장 많이 넘긴 액수와 그 날짜 */
  maxOver: number;
  maxDate: string;
  /** 최근까지 이어진 연속 초과일 */
  streak: number;
  /** 취소 대상인지 — overDays / days ≥ CANCEL_OVER_RATE */
  cancel: boolean;
}

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
  /**
   * 선정차수 — 뽑힌 적 있는 차수를 모두, 차수 순으로.
   *
   * 절반이 넘는 곳이 여러 차수에 걸쳐 다시 뽑혔다. 하나만 실으면 "1차 주유소"
   * 인데 실은 9차에도 뽑힌 곳을 옛날 것으로 오해하게 된다. 그래프에 선정 시점을
   * 표시할 때도 전부 필요하다 — 기간은 `baseline.windows[차수]` 에 있다.
   */
  rounds: string[];
  /**
   * 선정 이후 지역 평균 초과 이력. 선정 전이거나 견줄 자료가 없으면 null.
   *
   * 날짜별 내역은 싣지 않는다 — 472곳 × 190일이면 파일이 통째로 무거워진다.
   * 추이 창이 `history.json` 의 가격과 `regionMean` 으로 그 자리에서 낸다.
   */
  overRegion: OverRegion | null;
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

  /**
   * 보정 판정 — 선정 시점 대비 시장연동 이탈. 기준선이 없으면 null.
   *
   * 화면이 판정 방식을 바꿀 때마다 전국 1만 건 분포를 다시 셀 수는 없으므로
   * 집계 단계에서 미리 계산해 함께 싣는다. 세 기준(통합/휘발유/경유)을 미리
   * 실어 두는 것과 같은 이유다. — adjust.ts 참고
   */
  adjusted: AdjustedMetric | null;
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

/**
 * 이 횟수 이상 뽑힌 곳에 붙이는 표시.
 *
 * 아홉 차수 중 다섯 번을 든 곳이 스물두 곳이다. 한 번 뽑힌 곳과 같은 줄에
 * 두면 그 꾸준함이 묻힌다 — 차수 동그라미가 다섯 개라는 것은 세어야 보이지만
 * 이름표는 눈에 바로 걸린다.
 *
 * 지금은 다섯이 최대값이지만 차수가 더 쌓이면 여섯도 나온다. 그래서 '같음' 이
 * 아니라 '이상' 으로 센다.
 */
export const LOYAL_ROUNDS = 5;
export const LOYAL_LABEL = "착하디착한";

/** 신호등을 무엇으로 판정할지. */
export type JudgeMode = "rank" | "adjusted";

/** 보정 판정에서 순위와 이탈률을 묶는 방식. */
export type AdjustedCombine = "both" | "drift" | "rank";

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
    /** 주유소 단위 신호등 집계 — 현재(순위) 방식 */
    counts: Record<SignalColor, number>;
    /** 같은 집계를 보정 방식으로 센 것 */
    adjustedCounts: Record<SignalColor, number>;
  };

  /**
   * 현황판이 기본으로 보여줄 판정 방식.
   *
   * 두 방식의 값을 모두 싣고 이 값으로 어느 쪽을 보일지 고른다. 관리 화면에서
   * 바꾸며, 임계값과 마찬가지로 화면이 받아 그 자리에서 다시 판정한다.
   */
  judgeMode: JudgeMode;

  /**
   * 시·도 → 기준 → 1위부터 CUTOFF_K위까지의 커트라인(서로 다른 값, 오름차순).
   *
   * 관리 화면에서 기준 순위를 바꿨을 때 **집계를 기다리지 않고** 계수를 다시
   * 낼 수 있게 싣는다. 계수의 분모는 N번째로 싼 값이라 N이 바뀌면 같이 바뀌는데,
   * 전국 1만 건 분포는 화면에 없기 때문이다 — judge.ts 참고.
   */
  cutoffs?: Record<string, Partial<Record<ViewMode, number[]>>>;

  /** 같은 것을 보정 모집단(제외 추정분을 뺀)에서 낸 것. 통합 기준만 쓴다. */
  adjustedCutoffs?: Record<string, number[]>;

  /** 보정 판정에 쓴 차수별 기준기간과 그 근거. 화면이 한계를 밝히는 데 쓴다. */
  baseline: {
    windows: Record<string, string>;
    confirmedRounds: readonly string[];
    excludedCount: number;
    combine: AdjustedCombine;
    driftGreen: number;
    driftYellow: number;
  } | null;
}
