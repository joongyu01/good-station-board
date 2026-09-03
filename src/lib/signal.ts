/**
 * 신호등 판정
 *
 * 시군구 내 전체 주유소 가격 분포에서 z점수를 구해 색을 정한다.
 *
 *   z = (해당 주유소 가격 − 시군구 평균) / 시군구 표준편차
 *
 *   🟢 z ≤ −0.5        지역 평균보다 유의미하게 저렴
 *   🟡 −0.5 < z ≤ +0.5 평균 수준
 *   🔴 z > +0.5        지역 평균보다 비쌈
 */
import type { FuelType, RegionStat, SignalColor, StationPriceRow } from "./types.ts";
import { regionKey } from "./region.ts";

/** 초록/노랑 경계. z점수 기준. */
export const Z_GREEN = -0.5;
/** 노랑/빨강 경계. */
export const Z_RED = 0.5;

/**
 * 표본이 이보다 적으면 시군구 σ를 믿지 않고 시·도 통계로 대체한다.
 *
 * 명단에는 인천 옹진군, 경북 봉화군처럼 관내 주유소가 두세 곳뿐인 지역이 있다.
 * 그런 곳의 표본표준편차는 하루 단위로 크게 흔들려서, 가격이 거의 그대로인데도
 * 신호등 색만 매일 바뀌는 현상이 생긴다.
 */
export const MIN_SAMPLE = 5;

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
      const useFallback = own.n < MIN_SAMPLE;
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

/** z점수 → 신호등 색. */
export function toSignal(z: number | null): SignalColor {
  if (z == null || !Number.isFinite(z)) return "unknown";
  if (z <= Z_GREEN) return "green";
  if (z <= Z_RED) return "yellow";
  return "red";
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
