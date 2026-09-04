/** 현황판이 쓰는 데이터 로딩과 지역 집계 헬퍼. */
import type { BoardData, FuelType, SignalColor, StationSignal } from "@shared/lib/types.ts";
import { SIDO_LABELS } from "@shared/lib/region.ts";

export type { BoardData, FuelType, SignalColor, StationSignal };

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
  green: "지역 최저가",
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

/**
 * 지역 색은 그 지역에 **미달(빨강) 주유소가 얼마나 있는지**로 정한다.
 *
 *   🟢 미달 0곳
 *   🟡 미달이 있지만 절반 미만
 *   🔴 절반 이상이 미달
 *
 * 처음에는 격차의 평균을 썼는데 시·도 단위에서 무너졌다. 한 도의 착한주유소
 * 수십 곳을 평균 내면 거의 항상 20원을 넘어 전국 지도가 통째로 빨강이 됐다.
 * 비율은 지역 크기와 무관하게 같은 의미를 유지한다 — 시·군·구든 시·도든
 * "여기 점검 대상이 얼마나 되나"를 그대로 읽을 수 있다.
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
    s.signal = s.red === 0 ? "green" : s.red / judged < 0.5 ? "yellow" : "red";
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
