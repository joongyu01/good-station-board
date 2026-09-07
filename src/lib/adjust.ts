/**
 * 보정 판정 — 선정 시점 대비, 시장이 움직인 만큼을 뺀 이탈
 *
 * ## 지금 판정의 한계
 *
 * 현재 신호등은 '오늘 그 시·도에서 몇 위냐' 하나만 묻는다. 그런데 명단 472곳은
 * 아홉 차수에 걸쳐 뽑혔고 차수마다 선정 기준기간이 다르다. 선정된 지 오래된
 * 차수를 오늘의 상위 N위로 재면 뒤로 밀리는 것이 당연하다 — 잣대가 묻는
 * 질문이 선정 때와 다르기 때문이다.
 *
 * ## 무엇을 묻는가
 *
 * 보정 판정은 이렇게 묻는다. **선정 시점에 견줘, 그 지역 시장이 오른 만큼을
 * 빼고도 더 올렸는가.**
 *
 *   기대가 E    = 기준가 P0 × (오늘 시장 M1 ÷ 기준기간 시장 M0)
 *   이탈률 drift = (오늘 실제가 − E) ÷ E
 *
 * `P0` 는 그 주유소의 기준기간 일별 합계 평균, `M0`·`M1` 은 같은 잣대로 잰
 * 그 시·도 **전체** 주유소 합계의 중앙값이다.
 *
 * 이탈률이 0 이면 시장이 오른 만큼만 따라 올린 것이고, 양수면 그보다 더 올린
 * 것이다. 유가가 통째로 오르내려도 값이 흔들리지 않는다.
 *
 * ## 중앙값을 쓰는 이유
 *
 * 상위 N위 커트라인은 극단 순서통계량이라 싼 쪽 꼬리 몇 곳이 빠지고 드는 것만
 * 으로 통째로 움직인다. 중앙값은 그런 것에 꿈쩍하지 않아 시장이 어디로
 * 움직였는지를 재는 데 알맞다.
 *
 * ## 판정
 *
 * 보정 모드의 신호등은 **순위와 이탈률을 모두** 통과해야 초록이다. 둘 중 나쁜
 * 쪽 색을 따른다. 순위는 선정 때와 같은 잣대가 되도록 '선정 때 빠졌던 것으로
 * 보이는 주유소' 를 모집단에서 뺀 뒤 매긴다.
 */
import type { SignalColor } from "./types.ts";

/**
 * 차수별 선정 기준기간 — `YYYYMMDD~YYYYMMDD`.
 *
 * 예전에는 달(YYYYMM) 단위였고 1~8차가 전부 7월이었다. 보관 원본이 7월부터라
 * 그 이전을 볼 수 없었기 때문이다. 지금은 3월 1일부터 전부 있어 기간을 직접
 * 추산했다 — 근거와 수치는 ROUNDS.md §4, 재현은 `npm run rounds:estimate`.
 *
 * 격주 차수(1~7차)는 공시일이 아니라 **공시 나흘 전**에 마감한 것으로 잡는다.
 * 월간 차수가 그 시차를 그대로 보여준다 — 8차는 7/31 마감에 8/4 공시, 9차는
 * 8/31 마감에 9/3 공시다. 같은 시차를 격주 차수에 적용하면 충족률이 71%에서
 * 77%로 오른다. 다만 k=2~5 사이 차이가 크지 않아 **경계는 ±4일쯤 무르다.**
 *
 * 1차는 추산되지 않는다. 어느 기간을 갖다 대도 충족률이 2~3% 라 그때는 가격
 * 순위로 뽑은 것이 아니다. 여기 적힌 값은 격주 주기만 맞춘 것이다.
 *
 * 바꾸려면 `data/round-windows.json` 으로 덮어쓴다.
 */
export const DEFAULT_ROUND_WINDOWS: Record<string, string> = {
  "1차": "20260315~20260327",
  "2차": "20260328~20260409",
  "3차": "20260410~20260423",
  "4차": "20260424~20260507",
  "5차": "20260508~20260522",
  "6차": "20260523~20260604",
  "7차": "20260605~20260618",
  "8차": "20260701~20260731",
  "9차": "20260801~20260831",
};

/**
 * 기준기간이 데이터로 확인된 차수. 나머지는 화면에서 '추정' 으로 밝힌다.
 *
 * 4차부터는 그 차수에 뽑힌 곳의 73~84% 가 자기 기간에 시·도 상위 N위였다.
 * 1~3차는 기간을 옳게 짚어도 그 값이 5~13% 에 그친다 — 그때는 가격 순위로
 * 뽑지 않았기 때문이다(ROUNDS.md §4.2). 기간의 확실함이 다르므로 갈라 둔다.
 */
export const CONFIRMED_ROUNDS: readonly string[] = ["4차", "5차", "6차", "7차", "8차", "9차"];

/** 기간 문자열이 덮는 날짜들 (YYYYMMDD 오름차순). */
export function periodDays(period: string): string[] {
  const [from, to] = period.split("~");
  if (!from || !to) return [];
  const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}T00:00:00Z`;
  const out: string[] = [];
  const d = new Date(iso(from)), end = new Date(iso(to));
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * 화면 표기 — `20260424~20260507` → `4월 24일~5월 7일`.
 *
 * 달 단위(`202607`)도 받는다. 브라우저가 옛 latest.json 을 캐시하고 있으면
 * 그 표기가 그대로 올라오기 때문이다.
 */
export function periodLabel(period: string): string {
  const day = (s: string) => `${Number(s.slice(4, 6))}월 ${Number(s.slice(6))}일`;
  const [from, to] = period.split("~");
  if (!to) return /^\d{6}$/.test(from) ? `${from.slice(0, 4)}년 ${Number(from.slice(4, 6))}월` : from;
  return `${day(from)}~${day(to)}`;
}

/** 이탈률 임계값 — 이 값 이하면 초록. 0 이면 '시장만큼만 올렸다'. */
export const DRIFT_GREEN = 0;

/** 노랑 구간의 이탈률 상한. 이 값을 넘으면 빨강. */
export const DRIFT_YELLOW = 0.01;

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** build-baseline 이 만드는 파일. */
export interface Baseline {
  generatedAt: string;
  /** 차수 → 기준기간 `YYYYMMDD~YYYYMMDD` */
  windows: Record<string, string>;
  /** 기준기간 → 시·도 → 합계 중앙값 */
  market: Record<string, Record<string, number>>;
  /** 주유소코드 → 기준가 */
  stations: Record<string, { round: string; window: string; base: number; days: number }>;
  /** 선정 때 후보에서 빠졌던 것으로 보이는 주유소코드 */
  excluded: string[];
}

/** 보정 판정 한 건. */
export interface AdjustedMetric {
  /** 선정 기준기간 `YYYYMMDD~YYYYMMDD` */
  window: string;
  /** 그 기간이 데이터로 확인된 것인지. false 면 화면에 '추정' 을 붙인다. */
  windowConfirmed: boolean;
  /** 기준기간 일별 합계 평균 */
  base: number;
  /** 시장이 오른 만큼만 따라 올렸을 때의 오늘 가격 */
  expected: number;
  /** (오늘 실제가 − 기대가) ÷ 기대가 */
  drift: number;
  /** 이탈률만 놓고 본 색 */
  driftSignal: SignalColor;
  /** 제외 추정분을 뺀 모집단에서의 조밀 순위 */
  rank: number | null;
  /** 그 모집단 크기 */
  regionN: number;
  /** 제외 추정분을 뺀 모집단의 초록 커트라인 */
  greenBase: number | null;
  /** 오늘 합계 ÷ 그 커트라인 */
  coefficient: number | null;
  /** 순위만 놓고 본 색 */
  rankSignal: SignalColor;
  /** 둘 다 통과해야 초록. 나쁜 쪽을 따른다. */
  signal: SignalColor;
}

/** 이탈률만 놓고 본 색. */
export function driftSignalOf(drift: number, green = DRIFT_GREEN, yellow = DRIFT_YELLOW): SignalColor {
  if (drift <= green) return "green";
  if (drift <= yellow) return "yellow";
  return "red";
}

/**
 * 두 색 중 나쁜 쪽.
 *
 * 판정 불가(`unknown`·`stale`)는 섞지 않고 그대로 내보낸다 — 값이 없어서 못
 * 재는 것과 재 봤더니 미달인 것은 다른 이야기다.
 */
const ORDER: Record<string, number> = { green: 0, yellow: 1, red: 2 };
export function worseOf(a: SignalColor, b: SignalColor): SignalColor {
  if (!(a in ORDER)) return a;
  if (!(b in ORDER)) return b;
  return ORDER[a] >= ORDER[b] ? a : b;
}
