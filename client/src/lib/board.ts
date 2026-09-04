/** 현황판이 쓰는 데이터 로딩과 지역 집계 헬퍼. */
import type { BoardData, FuelType, SignalColor, StationSignal, ViewMode } from "@shared/lib/types.ts";
import { SIDO_LABELS } from "@shared/lib/region.ts";
import { VIEW_MODES, VIEW_MODE_LABELS } from "@shared/lib/types.ts";

export type { BoardData, FuelType, SignalColor, StationSignal, ViewMode };
export { VIEW_MODES, VIEW_MODE_LABELS };

/**
 * 고른 기준(통합/휘발유/경유)의 성적을 최상위 필드로 끌어올린다.
 *
 * 지도·표·요약이 모두 `signal`·`regionRank`·`priceIndex` 를 본다. 기준마다
 * 그것들을 갈아 끼워 주면 아래 코드는 손대지 않아도 된다.
 */
export function applyMode(stations: StationSignal[], mode: ViewMode): StationSignal[] {
  if (mode === "sum") return stations;
  return stations.map((s) => {
    // 브라우저가 옛 latest.json 을 캐시하고 있으면 metrics 가 없다.
    // 화면이 통째로 죽는 대신 합산 기준 그대로 보여준다.
    const m = s.metrics?.[mode];
    if (!m) return s;
    return {
      ...s,
      sum: m.price,
      priceIndex: m.coefficient != null && m.greenBase != null && m.price != null
        ? { sum: m.price, regionBase: m.greenBase, coefficient: m.coefficient }
        : null,
      regionMinSum: m.regionMin,
      regionMeanSum: m.regionMean,
      gapFromMin: m.gapFromMin,
      regionRank: m.regionRank,
      regionN: m.regionN,
      isRegionLowest: m.isRegionLowest,
      signal: m.signal,
    };
  });
}

/** 지도 폴리곤 1개. 여러 현행 시·군·구를 대표할 수 있다. */
export interface GeoFeature {
  type: "Feature";
  properties: {
    sido: string;
    label: string;
    /** 시·군·구 레이어 — 이 폴리곤이 대표하는 현행 단위들 */
    units?: string[];
    keys?: string[];
    /** 일반구 레이어 — 모체 시와 구 이름 */
    city?: string;
    district?: string;
  };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface GeoCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

/**
 * 신호등 색. K-Petro CI 팔레트에 맞춘 값이다.
 *
 * styles.css 의 --sig-* 와 같은 값을 쓴다. SVG 채우기와 인라인 style 에서
 * 쓰려면 JS 쪽에도 실제 값이 필요해 두 곳에 둔다.
 */
export const SIGNAL_COLORS: Record<SignalColor, string> = {
  green: "#6FA82E",
  yellow: "#E3A81E",
  red: "#C6402E",
  unknown: "#B9BDBE",
};

export const SIGNAL_LABELS: Record<SignalColor, string> = {
  green: "상위권",
  yellow: "근접",
  red: "미달",
  unknown: "미상",
};

/** 지역 단위 집계 — 지도 색칠에 쓴다. */
export interface RegionSummary {
  /** 폴리곤 표시 이름 */
  label: string;
  sido: string;
  green: number;
  yellow: number;
  red: number;
  unknown: number;
  total: number;
  /** 착한주유소들이 지역 최저가에서 평균 몇 원 떨어져 있는지. 지도 색의 근거. */
  meanGap: number | null;
  signal: SignalColor;
}

/** 지역이 초록으로 칠해지는 최소 상위권 비율. */
const GREEN_SHARE = 0.3;

/**
 * 지역 색은 그 지역 착한주유소 중 **상위권(초록)이 얼마나 되는지**로 정한다.
 *
 *   🟢 상위권이 30% 이상
 *   🟡 상위권이 있지만 30% 미만
 *   🔴 상위권이 하나도 없음
 *
 * 판정이 시·도 상위 N위 기준으로 바뀌면서 전국의 82%가 미달이 됐다. 그래서
 * "미달이 절반 이상이면 빨강" 같은 규칙은 모든 지역을 빨강으로 만들어 변별을
 * 못 한다. 반대로 "상위권이 있으면 초록" 은 너무 후해서 시·도가 거의 다
 * 초록이 된다. 비율로 잡아야 시·군·구(18/9/121)와 시·도(1/13/2) 양쪽에서
 * 의미가 살아난다.
 */
export function summarize(stations: StationSignal[], label: string, sido: string): RegionSummary {
  const s: RegionSummary = {
    label, sido,
    green: 0, yellow: 0, red: 0, unknown: 0,
    total: stations.length, meanGap: null, signal: "unknown",
  };
  const gaps: number[] = [];
  for (const st of stations) {
    s[st.signal]++;
    if (st.gapFromMin != null) gaps.push(st.gapFromMin);
  }
  if (gaps.length) s.meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;

  const judged = s.green + s.yellow + s.red;
  if (judged > 0) {
    const share = s.green / judged;
    s.signal = share >= GREEN_SHARE ? "green" : s.green > 0 ? "yellow" : "red";
  }
  return s;
}

/** 주유소를 지역키로 묶는다. */
export function groupByRegion(stations: StationSignal[]): Map<string, StationSignal[]> {
  const map = new Map<string, StationSignal[]>();
  for (const s of stations) {
    const arr = map.get(s.regionKey);
    if (arr) arr.push(s); else map.set(s.regionKey, [s]);
  }
  return map;
}

/** YYYYMMDD → "2026년 9월 2일" */
export function formatDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  const y = yyyymmdd.slice(0, 4);
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return `${y}년 ${m}월 ${d}일`;
}

export function formatPrice(v: number | null): string {
  return v == null ? "—" : `${Math.round(v).toLocaleString("ko-KR")}원`;
}

export function formatDiff(v: number | null): string {
  if (v == null) return "—";
  const r = Math.round(v);
  return r > 0 ? `+${r.toLocaleString("ko-KR")}` : r.toLocaleString("ko-KR");
}

/** 시·도 표시 이름. 통합시처럼 정식 명칭이 따로 있으면 그것을 쓴다. */
export function sidoLabel(sido: string): string {
  return (SIDO_LABELS as Record<string, string | undefined>)[sido] ?? sido;
}

/** 정적 배포 경로 어디서든 데이터 파일을 찾도록 base를 붙인다. */
export function dataUrl(name: string): string {
  return new URL(`data/${name}`, document.baseURI).toString();
}
