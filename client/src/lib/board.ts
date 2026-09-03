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

export const SIGNAL_COLORS: Record<SignalColor, string> = {
  green: "#16a34a",
  yellow: "#eab308",
  red: "#dc2626",
  unknown: "#94a3b8",
};

export const SIGNAL_LABELS: Record<SignalColor, string> = {
  green: "저렴",
  yellow: "보통",
  red: "비쌈",
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
  /** 착한주유소들의 평균 z점수. 지도 색은 이 값으로 정한다. */
  meanZ: number | null;
  signal: SignalColor;
}

/**
 * 지역 색은 그 지역 착한주유소들의 평균 z점수로 정한다.
 *
 * 개별 주유소와 같은 임계값(±0.5)을 쓰므로 "이 지역 착한주유소들이 동네 시세보다
 * 싼가"를 그대로 읽을 수 있다. 초록이 아닌 지역이 곧 점검 대상이다.
 */
export function summarize(stations: StationSignal[], label: string, sido: string): RegionSummary {
  const s: RegionSummary = {
    label, sido,
    green: 0, yellow: 0, red: 0, unknown: 0,
    total: stations.length, meanZ: null, signal: "unknown",
  };
  const zs: number[] = [];
  for (const st of stations) {
    s[st.signal]++;
    if (st.zScore != null) zs.push(st.zScore);
  }
  if (zs.length) {
    s.meanZ = zs.reduce((a, b) => a + b, 0) / zs.length;
    s.signal = s.meanZ <= -0.5 ? "green" : s.meanZ <= 0.5 ? "yellow" : "red";
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
