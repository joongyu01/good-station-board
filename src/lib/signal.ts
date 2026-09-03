/**
 * 신호등 판정 — **지역 최저가 기준**
 *
 * 착한주유소는 자기 지역에서 가장 싸야 한다는 것이 제도의 취지다. 그래서 평균이
 * 아니라 그 시·군·구의 **최저가**를 기준선으로 삼는다.
 *
 *   🟢 최저가   그 지역 최저가와 같음
 *   🟡 근접     최저가 + 20원 이내
 *   🔴 미달     그보다 비쌈
 *
 * 노랑 구간을 둔 이유가 있다. 최저가와 1원 차이인 곳과 200원 차이인 곳을 똑같이
 * 빨강으로 칠하면 정작 급한 곳을 골라낼 수 없다. 사실상 최저가권인 곳을 노랑으로
 * 흡수해야 빨강이 실제 점검 대상 목록이 된다.
 *
 * 평균·표준편차는 계속 계산한다. 신호등 판정에는 쓰지 않지만 "지역평균 대비 얼마"가
 * 담당자에게는 여전히 필요한 수치라 화면 표에 남긴다.
 */
import type { FuelType, RegionStat, SignalColor, StationPriceRow } from "./types.ts";
import { regionKey } from "./region.ts";

/**
 * 초록/노랑 경계 — 지역 최저가와의 차이(원/L).
 * 0이면 최저가와 정확히 같아야 초록이다.
 */
export const GAP_GREEN = 0;
/**
 * 노랑/빨강 경계 — 지역 최저가 + 이 값까지는 노랑.
 * 운영하며 조정할 값이라 여기 한 곳만 고치면 된다.
 */
export const GAP_YELLOW = 20;

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

/**
 * 지역 최저가와의 차이 → 신호등 색.
 *
 * @param gap 해당 주유소 가격 − 그 지역 최저가 (원/L). 0이면 최저가.
 */
export function toSignal(gap: number | null): SignalColor {
  if (gap == null || !Number.isFinite(gap)) return "unknown";
  if (gap <= GAP_GREEN) return "green";
  if (gap <= GAP_YELLOW) return "yellow";
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
