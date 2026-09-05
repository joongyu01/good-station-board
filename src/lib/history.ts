import { COEF_DIGITS } from "./signal.ts";

/**
 * 착한주유소 일별 시계열.
 *
 * 화면에서 주유소 하나를 누르면 휘발유·경유 판매가와 계수의 추이를 그린다.
 * 그러려면 날짜별 값이 있어야 하는데, 하루치 판정 결과(board-{date}.json)는
 * 한 건이 400KB 라 두 달치를 그대로 실을 수 없다.
 *
 * 그래서 필요한 세 값만 뽑아 **날짜축 하나에 병렬 배열**로 눕힌다.
 *   dates:    ["20260701", "20260702", ...]
 *   g/d/c:    같은 길이의 배열. 그날 값이 없으면 null.
 *
 * 472곳 × 65일이면 500KB 남짓이라 한 번에 받아도 부담이 없다.
 *
 * 키는 seq 가 아니라 **오피넷 주유소코드**다. 명단을 갈아끼우면 seq 는 통째로
 * 밀리지만 주유소코드는 그대로라 과거치가 살아남는다.
 */

/** 주유소 1곳의 시계열. 배열 길이는 모두 dates 와 같다. */
export interface StationSeries {
  /** 휘발유 (원/L) */
  g: (number | null)[];
  /** 경유 (원/L) */
  d: (number | null)[];
  /** 합산 계수. 1.000 이 그날 그 시·도의 초록불 커트라인 */
  c: (number | null)[];
  /**
   * 그날의 판정. `g` 적합 · `y` 근접 · `r` 초과 · null 판정 못 함.
   *
   * 계수만으로는 근접을 가려낼 수 없다. 적합은 "계수 ≤ 1.000" 으로 떨어지지만
   * 근접은 2N위 안쪽이라는 뜻이라 그날의 전국 분포를 다시 봐야 한다. 그래서
   * 그날 계산한 결과를 그대로 적어 둔다.
   */
  s: (DaySignal | null)[];
}

export type DaySignal = "g" | "y" | "r";

export interface History {
  /** 오름차순 날짜축 YYYYMMDD */
  dates: string[];
  /** 오피넷 주유소코드 → 시계열 */
  stations: Record<string, StationSeries>;
  generatedAt: string;
}

export function emptyHistory(): History {
  return { dates: [], stations: {}, generatedAt: new Date().toISOString() };
}

/** 하루치 관측값 — 한 날짜의 주유소코드별 값 */
export interface DaySample {
  gasoline: number | null;
  diesel: number | null;
  coefficient: number | null;
  signal: DaySignal | null;
}

/**
 * 하루치를 병합한다. 이미 있는 날짜면 값을 덮어쓰고, 없으면 날짜축에 끼워 넣는다.
 *
 * 날짜축이 바뀌면 모든 주유소의 배열 길이가 같이 늘어나야 한다. 한 곳이라도
 * 어긋나면 차트의 x축과 y값이 밀리므로 여기서 한꺼번에 맞춘다.
 */
export function mergeDay(h: History, date: string, samples: Map<string, DaySample>): History {
  let at = h.dates.indexOf(date);

  if (at < 0) {
    at = h.dates.findIndex((d) => d > date);
    if (at < 0) at = h.dates.length;
    h.dates.splice(at, 0, date);
    for (const s of Object.values(h.stations)) {
      s.g.splice(at, 0, null);
      s.d.splice(at, 0, null);
      s.c.splice(at, 0, null);
      (s.s ??= new Array(h.dates.length - 1).fill(null)).splice(at, 0, null);
    }
  }

  const len = h.dates.length;
  for (const [id, v] of samples) {
    let s = h.stations[id];
    if (!s) {
      // 새로 등장한 주유소. 그 전 날짜들은 값이 없다.
      s = {
        g: new Array(len).fill(null), d: new Array(len).fill(null),
        c: new Array(len).fill(null), s: new Array(len).fill(null),
      };
      h.stations[id] = s;
    }
    s.g[at] = v.gasoline;
    s.d[at] = v.diesel;
    s.c[at] = v.coefficient;
    (s.s ??= new Array(len).fill(null))[at] = v.signal;
  }

  return h;
}

/** 명단에서 빠진 주유소의 시계열을 버린다. 파일이 계속 불어나는 것을 막는다. */
export function pruneTo(h: History, keep: Set<string>): number {
  let dropped = 0;
  for (const id of Object.keys(h.stations)) {
    if (!keep.has(id)) { delete h.stations[id]; dropped++; }
  }
  return dropped;
}

/**
 * 하루치 전국 가격 행에서 착한주유소들의 관측값을 뽑는다.
 *
 * 계수는 그날의 시·도별 합계 분포에서 초록불 커트라인을 구해 환산한다. 과거
 * 어느 날의 계수는 **그날의 시세** 기준이어야 추이가 뜻을 갖는다. 오늘 기준선을
 * 과거에 소급하면 유가가 전체적으로 오르내린 것까지 개별 주유소 탓으로 보인다.
 */
export function sampleDay(
  rows: Array<{ stationId: string; sido: string; gasoline: number | null; diesel: number | null }>,
  targetIds: Set<string>,
  greenRankOf: (sido: string) => number,
  yellowFactor = 2,
): Map<string, DaySample> {
  // 시·도별 합계 분포
  const sums = new Map<string, number[]>();
  for (const r of rows) {
    const g = r.gasoline;
    const d = r.diesel;
    if (g == null || g <= 0 || d == null || d <= 0) continue;
    const arr = sums.get(r.sido);
    if (arr) arr.push(g + d); else sums.set(r.sido, [g + d]);
  }

  // 그날의 커트라인 두 개 — 적합(N위)과 근접(2N위).
  const base = new Map<string, { green: number; yellow: number; sorted: number[] }>();
  for (const [sido, arr] of sums) {
    arr.sort((a, b) => a - b);
    const n = greenRankOf(sido);
    base.set(sido, {
      green: arr[Math.min(n, arr.length) - 1],
      yellow: arr[Math.min(n * yellowFactor, arr.length) - 1],
      sorted: arr,
    });
  }

  const out = new Map<string, DaySample>();
  for (const r of rows) {
    if (!targetIds.has(r.stationId)) continue;
    const g = r.gasoline && r.gasoline > 0 ? r.gasoline : null;
    const d = r.diesel && r.diesel > 0 ? r.diesel : null;
    const b = base.get(r.sido);

    let coefficient: number | null = null;
    let signal: DaySignal | null = null;
    if (g != null && d != null && b != null && b.green > 0) {
      const sum = g + d;
      coefficient = Math.round((sum / b.green) * 10 ** COEF_DIGITS) / 10 ** COEF_DIGITS;
      signal = sum <= b.green ? "g" : sum <= b.yellow ? "y" : "r";
    }

    out.set(r.stationId, { gasoline: g, diesel: d, coefficient, signal });
  }
  return out;
}

/** 기준 충족 집계를 시작하는 날. 여기부터 최신일까지가 기본 조회 구간이다. */
export const COMPLIANCE_FROM = "20260801";

/**
 * 며칠이나 기준 안에 들어왔는지.
 *
 * 계수 1.000 이 그날 그 시·도의 상위권 커트라인이므로, 1.000 이하인 날이
 * '충족' 이다. 하루치 신호등은 그날 사정에 따라 흔들리지만 이 값은 한 달치
 * 성적이라 그 주유소가 꾸준했는지를 보여준다.
 */
export interface Compliance {
  /** 집계 구간 (YYYYMMDD) */
  from: string;
  to: string;
  /** 가격기준 적합이었던 날 */
  greenDays: number;
  /** 가격기준 근접이었던 날 */
  yellowDays: number;
  /** 가격기준 초과였던 날 */
  redDays: number;
  /** 가격이 없어 판정하지 못한 날 */
  missingDays: number;
}

export function complianceOf(h: History, id: string, from: string): Compliance {
  const series = h.stations[id];
  const out: Compliance = {
    from, to: from, greenDays: 0, yellowDays: 0, redDays: 0, missingDays: 0,
  };

  for (let i = 0; i < h.dates.length; i++) {
    const date = h.dates[i];
    if (date < from) continue;
    out.to = date;

    const s = series?.s?.[i];
    if (s === "g") out.greenDays++;
    else if (s === "y") out.yellowDays++;
    else if (s === "r") out.redDays++;
    else out.missingDays++;
  }

  return out;
}
