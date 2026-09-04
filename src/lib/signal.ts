/**
 * 신호등 판정 — **주유소 단위, 시·도 내 합산 순위 기준**
 *
 * 점수는 휘발유+경유를 합친 값 하나다. 그러니 판정도 유종별로 쪼개지 않고
 * 주유소 하나에 신호등 하나를 준다. 유종별로 따로 색을 매기면 같은 주유소가
 * 휘발유는 초록, 경유는 빨강으로 나와 "이 주유소는 싼가"라는 질문에 답을
 * 못 한다.
 *
 * 비교 모집단은 시·도(특별시·광역시·도)다. 시·군·구가 아니다. 같은 도 안에서는
 * 유통 여건이 비슷하고, 시·군·구로 쪼개면 주유소가 두세 곳뿐인 곳이 생겨
 * "관내 1위"가 아무 의미도 없어지기 때문이다. 모집단에는 휘발유와 경유를
 * **모두 파는** 주유소만 넣는다 — 한 유종만 파는 곳의 합계는 존재하지 않는다.
 *
 *   🟢 초록  그 시·도 합산가 상위 N위 이내
 *   🟡 노랑  N위 밖이지만 2N위 이내
 *   🔴 빨강  그보다 뒤
 *
 * N 은 지역에 따라 다르다. 서울·경기는 주유소가 압도적으로 많아(각각 389곳,
 * 2167곳) 같은 5위 기준을 적용하면 사실상 아무도 통과하지 못한다. 그래서
 * 서울·경기는 10위, 나머지 시·도는 5위로 둔다.
 */
import type { SignalColor } from "./types.ts";

/**
 * 초록 기준 순위 — 서울·경기.
 * 두 지역은 주유소가 수백~수천 곳이라 다른 시·도와 같은 잣대를 못 쓴다.
 */
export const RANK_GREEN_METRO = 10;

/** 초록 기준 순위 — 그 밖의 시·도. */
export const RANK_GREEN_DEFAULT = 5;

/** 노랑 구간은 초록 기준의 이 배수 순위까지. */
export const RANK_YELLOW_FACTOR = 2;

/** 서울·경기 여부에 따라 초록 기준 순위를 고른다. */
export function greenRankFor(sido: string): number {
  return sido === "서울" || sido === "경기" ? RANK_GREEN_METRO : RANK_GREEN_DEFAULT;
}

/** 집계에 쓰는 임계값 묶음. 관리 화면에서 내려온 값으로 덮어쓸 수 있다. */
export interface Thresholds {
  /** 서울·경기 초록 기준 순위 */
  rankGreenMetro: number;
  /** 그 밖의 시·도 초록 기준 순위 */
  rankGreenDefault: number;
  /** 노랑 구간 배수 */
  rankYellowFactor: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  rankGreenMetro: RANK_GREEN_METRO,
  rankGreenDefault: RANK_GREEN_DEFAULT,
  rankYellowFactor: RANK_YELLOW_FACTOR,
};

/** 임계값을 반영한 초록 기준 순위. */
export function greenRankWith(sido: string, th: Thresholds): number {
  return sido === "서울" || sido === "경기" ? th.rankGreenMetro : th.rankGreenDefault;
}

/**
 * 순위 판정에 필요한 최소 모집단 크기.
 *
 * 비교 대상이 자기 자신뿐이면 자동으로 1위가 되어버린다. 그런 초록은 사실과
 * 다르므로 '미상'으로 떨어뜨린다. 시·도 단위에서는 가장 작은 세종도 60곳이
 * 넘어 실제로 걸리는 일은 없지만, 기준을 시·군·구로 되돌릴 때를 대비해 둔다.
 */
export const MIN_COMPARE = 2;

export interface Distribution {
  n: number;
  mean: number;
  stdev: number;
  min: number;
  max: number;
  /** 오름차순 값 목록 — 순위 계산에 쓴다 */
  sorted: number[];
}

/** 표본표준편차(n-1)를 포함한 분포 통계. */
export function describe(values: number[]): Distribution {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: 0, stdev: 0, min: 0, max: 0, sorted: [] };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const stdev =
    n < 2 ? 0 : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  return { n, mean, stdev, min: sorted[0], max: sorted[n - 1], sorted };
}

/**
 * 시·도 내 합산 순위 → 신호등 색.
 *
 * @param rank      1 이 그 시·도 최저 합계
 * @param greenRank 초록 기준 순위 (서울·경기 10, 그 외 5)
 * @param n         모집단 크기. MIN_COMPARE 미만이면 판정하지 않는다.
 */
export function toSignal(
  rank: number | null,
  greenRank: number,
  yellowFactor: number = RANK_YELLOW_FACTOR,
  n: number = Infinity,
): SignalColor {
  if (rank == null || !Number.isFinite(rank)) return "unknown";
  if (n < MIN_COMPARE) return "unknown";
  if (rank <= greenRank) return "green";
  if (rank <= greenRank * yellowFactor) return "yellow";
  return "red";
}

/**
 * 휘발유+경유 합산 가격지수.
 *
 * 그 시·도의 최저 휘발유가 + 최저 경유가를 1.000 으로 두고 비례 환산한다.
 * 기준선은 서로 다른 주유소의 최저가를 더한 값이라 실제로 그 값에 파는 곳은
 * 없을 수 있다. 환산 기준일 뿐이다.
 */
export function priceIndexOf(
  gasoline: number | null,
  diesel: number | null,
  regionMinGasoline: number | null,
  regionMinDiesel: number | null,
): { sum: number; regionBase: number; coefficient: number } | null {
  if (gasoline == null || diesel == null) return null;
  if (regionMinGasoline == null || regionMinDiesel == null) return null;
  const regionBase = regionMinGasoline + regionMinDiesel;
  if (!(regionBase > 0)) return null;
  const sum = gasoline + diesel;
  return { sum, regionBase, coefficient: Math.round((sum / regionBase) * 1000) / 1000 };
}

/** 오름차순 목록에서 순위(1 = 최저)를 구한다. 동가는 같은 순위. */
export function rankOf(value: number, sorted: number[]): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}
