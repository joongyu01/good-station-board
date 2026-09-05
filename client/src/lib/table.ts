/** 주유소 목록의 정렬과 CSV 내려받기. */
import { SIGNAL_LABELS, type StationSignal } from "./board.ts";
import { VIEW_MODE_LABELS, VIEW_MODES } from "@shared/lib/types.ts";
import { BRAND_LABELS, withBrand } from "@shared/lib/brand.ts";

export type SortKey =
  | "signal" | "name" | "region"
  | "gasoline" | "diesel" | "coefficient" | "rank" | "compliance";

export type SortDir = "asc" | "desc";
export interface SortState { key: SortKey; dir: SortDir }

/** 신호등을 좋은 쪽부터 늘어놓기 위한 순서. */
const SIGNAL_ORDER: Record<string, number> = { green: 0, yellow: 1, red: 2, stale: 3, unknown: 4 };

function valueOf(s: StationSignal, key: SortKey): number | string | null {
  switch (key) {
    case "signal": return SIGNAL_ORDER[s.signal] ?? 9;
    case "name": return s.name;
    case "region": return `${s.sido} ${s.sigungu}`;
    case "gasoline": return s.prices.gasoline;
    case "diesel": return s.prices.diesel;
    case "coefficient": return s.priceIndex?.coefficient ?? null;
    case "rank": return s.regionRank;
    case "compliance": return s.compliance?.greenDays ?? null;
  }
}

/**
 * 목록을 정렬한다.
 *
 * 값이 없는 행(가격 미신고, 미매칭)은 오름·내림 어느 쪽이든 **항상 끝**으로
 * 보낸다. 내림차순에서 '—' 가 맨 위로 올라오면 목록의 첫 화면이 빈칸으로
 * 채워져 쓸모가 없다.
 */
export function sortStations(list: StationSignal[], sort: SortState | null): StationSignal[] {
  if (!sort) return list;
  const sign = sort.dir === "asc" ? 1 : -1;

  return [...list].sort((a, b) => {
    const va = valueOf(a, sort.key);
    const vb = valueOf(b, sort.key);

    if (va == null && vb == null) return a.seq - b.seq;
    if (va == null) return 1;
    if (vb == null) return -1;

    let d = 0;
    if (typeof va === "string" || typeof vb === "string") {
      d = String(va).localeCompare(String(vb), "ko-KR");
    } else {
      d = va - vb;
    }
    // 같은 값이면 명단 순서로 고정한다. 안 그러면 다시 정렬할 때마다 행이 뒤바뀐다.
    return d === 0 ? a.seq - b.seq : d * sign;
  });
}

/** 헤더를 눌렀을 때 다음 정렬 상태. 같은 열을 세 번 누르면 정렬을 푼다. */
export function nextSort(cur: SortState | null, key: SortKey, firstDir: SortDir = "asc"): SortState | null {
  if (!cur || cur.key !== key) return { key, dir: firstDir };
  if (cur.dir === firstDir) return { key, dir: firstDir === "asc" ? "desc" : "asc" };
  return null;
}

// ── CSV ──────────────────────────────────────────────────────────────

type Col = [string, (s: StationSignal) => string | number | null];

/**
 * CSV 열.
 *
 * 세 기준(통합·휘발유·경유)의 순위와 계수를 **모두** 넣는다. 화면은 한 번에
 * 하나만 보여주지만, 내려받은 파일에서 기준을 바꿔 가며 비교하려면 세 벌이
 * 다 있어야 한다.
 */
const COLUMNS: Col[] = [
  ["상호", (s) => s.name],
  ["폴", (s) => (s.brand ? BRAND_LABELS[s.brand] : "")],
  ["폴코드", (s) => s.brand ?? ""],
  ["셀프", (s) => (s.isSelf ? "셀프" : "일반")],
  ["시도", (s) => s.sido],
  ["시군구", (s) => s.sigungu],
  ["일반구", (s) => s.district ?? ""],
  ["휘발유", (s) => s.prices.gasoline],
  ["경유", (s) => s.prices.diesel],
  ["합계", (s) => s.sum],
  ...VIEW_MODES.flatMap((m): Col[] => {
    const label = VIEW_MODE_LABELS[m];
    return [
      [`${label}_계수`, (s) => s.metrics?.[m]?.coefficient ?? null],
      [`${label}_시도순위`, (s) => s.metrics?.[m]?.regionRank ?? null],
      [`${label}_시도모집단`, (s) => s.metrics?.[m]?.regionN ?? null],
      [`${label}_시도최저`, (s) => s.metrics?.[m]?.regionMin ?? null],
      [`${label}_상위권커트라인`, (s) => s.metrics?.[m]?.greenBase ?? null],
      [`${label}_판정`, (s) => (s.metrics?.[m] ? SIGNAL_LABELS[s.metrics[m].signal] : "")],
    ];
  }),
  ["집계시작", (s) => s.compliance?.from ?? ""],
  ["집계종료", (s) => s.compliance?.to ?? ""],
  ["적합일수", (s) => s.compliance?.greenDays ?? null],
  ["근접일수", (s) => s.compliance?.yellowDays ?? null],
  ["초과일수", (s) => s.compliance?.redDays ?? null],
  ["미신고일수", (s) => s.compliance?.missingDays ?? null],
  ["주유소코드", (s) => s.stationId ?? ""],
  ["위도", (s) => s.lat],
  ["경도", (s) => s.lng],
];

function cell(v: string | number | null): string {
  if (v == null) return "";
  const t = String(v);
  // 쉼표·따옴표·줄바꿈이 들어간 값은 감싸준다. 상호에 쉼표가 있는 곳이 있다.
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function toCsv(stations: StationSignal[]): string {
  const lines = [COLUMNS.map(([h]) => cell(h)).join(",")];
  for (const s of stations) {
    lines.push(COLUMNS.map(([, get]) => cell(get(s))).join(","));
  }
  return lines.join("\r\n");
}

/**
 * CSV 를 파일로 내려받는다.
 *
 * 맨 앞에 BOM 을 붙인다. 없으면 엑셀이 UTF-8 로 알아보지 못해 한글이 전부
 * 깨진 채 열린다.
 */
export function downloadCsv(stations: StationSignal[], filename: string): void {
  // 첫 인자가 BOM(U+FEFF)이다. 눈에 보이지 않으니 지우지 말 것.
  const blob = new Blob(["﻿", toCsv(stations)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 즉시 회수하면 브라우저가 저장을 마치기 전에 링크가 끊길 수 있다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `착한주유소_전국_20260904.csv` */
export function csvName(scope: string, date: string): string {
  const safe = scope.replace(/[\\/:*?"<>|\s]+/g, "_");
  return `착한주유소_${safe}_${date}.csv`;
}

export { withBrand };
