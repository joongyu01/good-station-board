/**
 * 신호등 판정 — **시·도 내 순위 기준**
 *
 * 비교 모집단은 시·도(특별시·광역시·도)다. 시·군·구가 아니다. 같은 도 안에서는
 * 유통 여건이 비슷하고, 시·군·구로 쪼개면 주유소가 두세 곳뿐인 곳이 생겨
 * "관내 1위"가 아무 의미도 없어지기 때문이다.
 *
 *   🟢 초록  그 시·도에서 상위 N위 이내
 *   🟡 노랑  N위 밖이지만 2N위 이내
 *   🔴 빨강  그보다 뒤
 *
 * N 은 지역에 따라 다르다. 서울·경기는 주유소가 압도적으로 많아(각각 389곳,
 * 2167곳) 같은 5위 기준을 적용하면 사실상 아무도 통과하지 못한다. 그래서
 * 서울·경기는 10위, 나머지 시·도는 5위로 둔다.
 *
 * 평균·표준편차는 계속 계산해 화면 표에 남긴다. 판정에는 쓰지 않지만
 * "지역평균 대비 얼마"가 담당자에게는 여전히 필요한 수치다.
 */
import type { FuelType, RegionStat, SignalColor, StationPriceRow } from "./types.ts";
import { regionKey } from "./region.ts";

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

/** @deprecated 최저가 기준이던 시절의 값. 화면 표시에만 남아 있다. */
export const GAP_GREEN = 0;
/**
 * 노랑/빨강 경계 기본값 — 지역 최저가 + 이 값까지는 노랑.
 *
 * 관리 화면(판정 설정)에서 바꾼 값이 있으면 그쪽이 우선한다. 여기 값은
 * Supabase 를 쓰지 않을 때의 기본값이다.
 */
export const GAP_YELLOW = 20;

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

/** z점수는 신호등에 쓰지 않지만 화면 표시용으로 계속 계산한다. */
export const Z_GREEN = -0.5;
export const Z_RED = 0.5;

/**
 * 표본이 이보다 적으면 시군구 σ를 믿지 않고 시·도 통계로 대체한다.
 *
 * 명단에는 인천 옹진군, 경북 봉화군처럼 관내 주유소가 두세 곳뿐인 지역이 있다.
 * 그런 곳의 표본표준편차는 하루 단위로 크게 흔들려서, 가격이 거의 그대로인데도
 * 신호등 색만 매일 바뀌는 현상이 생긴다.
 */
export const MIN_SAMPLE = 5;

/**
 * 최저가 판정에 필요한 최소 주유소 수.
 *
 * 관내 주유소가 그 한 곳뿐이면 자동으로 "지역 최저가"가 되어버린다. 실제로
 * 부산 중구가 그렇다. 비교 대상이 없는데 초록을 주면 사실과 다르므로 '미상'으로
 * 떨어뜨린다.
 */
export const MIN_COMPARE = 2;

export interface Distribution {
  n: number;
  mean: number;
  stdev: number;
  min: number;
  max: number;
  /** 오름차순 가격 목록 — 순위 계산에 쓴다 */
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
 * 전국 가격 행에서 시군구 × 유종 통계를 만든다.
 * 표본이 MIN_SAMPLE 미만인 시군구는 같은 시·도 통계로 대체한다.
 */
export function buildRegionStats(
  rows: Array<StationPriceRow & { sigungu: string }>,
  fuelTypes: FuelType[],
  minSample: number = MIN_SAMPLE,
): Map<string, RegionStat> {
  const stats = new Map<string, RegionStat>();

  for (const fuel of fuelTypes) {
    // 시군구별 / 시도별 가격 수집
    const bySigungu = new Map<string, { sido: string; sigungu: string; values: number[] }>();
    const bySido = new Map<string, number[]>();

    for (const row of rows) {
      const price = row[fuel];
      if (price == null || price <= 0) continue;

      const key = regionKey(row.sido, row.sigungu);
      let bucket = bySigungu.get(key);
      if (!bucket) {
        bucket = { sido: row.sido, sigungu: row.sigungu, values: [] };
        bySigungu.set(key, bucket);
      }
      bucket.values.push(price);

      const sidoBucket = bySido.get(row.sido) ?? [];
      sidoBucket.push(price);
      bySido.set(row.sido, sidoBucket);
    }

    const sidoDist = new Map<string, Distribution>();
    for (const [sido, values] of bySido) {
      sidoDist.set(sido, describe(values));
    }

    for (const [key, bucket] of bySigungu) {
      const own = describe(bucket.values);
      const useFallback = own.n < minSample;
      const basis = useFallback ? sidoDist.get(bucket.sido) : undefined;

      stats.set(`${key}|${fuel}`, {
        regionKey: key,
        sido: bucket.sido,
        sigungu: bucket.sigungu,
        fuelType: fuel,
        // 평균은 언제나 해당 시군구의 실제 평균을 쓴다. 대체하는 것은 σ뿐이다.
        // 표본이 적어도 "우리 동네 평균가"는 그 동네 값이어야 담당자가 납득한다.
        n: own.n,
        mean: round(own.mean),
        stdev: round(basis ? basis.stdev : own.stdev),
        min: own.min,
        max: own.max,
        fallback: useFallback && basis != null,
        basisKey: useFallback && basis != null ? bucket.sido : key,
      });
    }
  }

  return stats;
}

/**
 * 시·도 내 순위 → 신호등 색.
 *
 * @param rank      1 이 그 시·도 최저가
 * @param greenRank 초록 기준 순위 (서울·경기 10, 그 외 5)
 */
export function toSignal(
  rank: number | null,
  greenRank: number,
  yellowFactor: number = RANK_YELLOW_FACTOR,
): SignalColor {
  if (rank == null || !Number.isFinite(rank)) return "unknown";
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

/**
 * 가격과 시군구 통계로 z점수를 낸다.
 *
 * σ가 0이면 (모든 주유소가 같은 가격이거나 표본이 1개) 나눗셈이 불가능하다.
 * 이때는 가격이 평균과 같으면 노랑, 다르면 부호에 따라 초록/빨강으로 떨어뜨린다.
 */
export function computeZ(price: number, stat: RegionStat): number | null {
  if (stat.stdev > 0) {
    return (price - stat.mean) / stat.stdev;
  }
  const diff = price - stat.mean;
  if (Math.abs(diff) < 0.5) return 0;
  return diff < 0 ? Z_GREEN : Z_RED + 0.01;
}

/** 오름차순 가격 목록에서 순위(1 = 최저가)를 구한다. 동가는 같은 순위. */
export function rankOf(price: number, sorted: number[]): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < price) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
