/**
 * 목록 검색 — 이름도 찾고 조건도 건다.
 *
 * 상호만 찾는 상자로는 "계수가 1을 넘는 9차 주유소" 같은 것을 못 본다. 그렇다고
 * 조건마다 드롭다운을 달면 머리가 무거워지고 모바일에서는 자리도 없다. 그래서
 * 한 칸에 **낱말과 조건을 섞어** 쓰게 한다.
 *
 *   대복          상호·주소·상표에 '대복'
 *   9차           9차에 뽑힌 곳
 *   계수<1        계수가 1 미만
 *   순위<=5       시·도 순위 5위 이내
 *   휘발유<1700   휘발유 1,700원 미만
 *   적합          가격기준 적합
 *   셀프 경기 계수<0.99      ← 띄어쓰면 모두 만족하는 곳
 *
 * 낱말은 모두 **AND** 다. 거르기는 좁히려고 쓰는 것이라 낱말을 더할수록 줄어드는
 * 편이 예측하기 쉽다.
 *
 * 조건을 못 알아들으면 그 낱말은 **그냥 글자로** 찾는다. 오타 하나에 결과가 통째로
 * 비는 것보다, 이름으로 찾아 주는 편이 덜 놀랍다.
 */
import type { SignalColor, StationSignal, ViewMode } from "@shared/lib/types.ts";
import { BRAND_LABELS } from "@shared/lib/brand.ts";

/** 조건을 걸 수 있는 값. 화면 도움말에 그대로 쓴다. */
const FIELDS: Record<string, (s: StationSignal, mode: ViewMode) => number | null> = {
  계수: (s) => s.priceIndex?.coefficient ?? null,
  순위: (s) => s.regionRank,
  가격: (s) => s.sum,
  합계: (s) => s.sum,
  휘발유: (s) => s.prices?.gasoline ?? null,
  경유: (s) => s.prices?.diesel ?? null,
  적합일: (s) => s.compliance?.greenDays ?? null,
  미신고: (s) => s.dataGapDays,
};

const SIGNAL_WORDS: Record<string, SignalColor> = {
  적합: "green", 상위권: "green",
  근접: "yellow",
  초과: "red", 미달: "red",
  정보없음: "unknown", 가격정보없음: "unknown",
  과거미신고: "stale",
};

const OPS = ["<=", ">=", "!=", "<", ">", "=", ":"] as const;
type Op = typeof OPS[number];

function compare(v: number, op: Op, n: number): boolean {
  switch (op) {
    case "<": return v < n;
    case "<=": return v <= n;
    case ">": return v > n;
    case ">=": return v >= n;
    case "!=": return v !== n;
    default: return Math.abs(v - n) < 1e-9;
  }
}

type Term = (s: StationSignal, mode: ViewMode) => boolean;

/** 글자 하나로 찾을 자리 — 상호·시·군·구·시·도·주소·상표. */
function haystack(s: StationSignal): string {
  const brand = s.brand ? `${s.brand} ${BRAND_LABELS[s.brand] ?? ""}` : "";
  return `${s.name} ${s.sido} ${s.sigungu} ${s.district ?? ""} ${brand}`.toLowerCase();
}

function parseTerm(word: string): Term {
  const raw = word.trim();
  if (!raw) return () => true;
  const lower = raw.toLowerCase();

  // 신호등 낱말
  const sig = SIGNAL_WORDS[raw.replace(/\s/g, "")];
  if (sig) return (s) => s.signal === sig;

  if (raw === "셀프") return (s) => s.isSelf;
  if (raw === "최저" || raw === "시도최저") return (s) => s.isRegionLowest;

  // 차수 — `9차`, `차수:9`, `차수=9차` 를 모두 받는다.
  const round = /^(?:차수[:=])?(\d{1,2})차?$/.exec(raw);
  if (round && (raw.includes("차") || raw.startsWith("차수"))) {
    const want = `${Number(round[1])}차`;
    return (s) => (s.rounds ?? []).includes(want);
  }

  // 값 조건 — `계수<1.02`
  for (const op of OPS) {
    const at = raw.indexOf(op);
    if (at <= 0) continue;
    const key = raw.slice(0, at).trim();
    const rest = raw.slice(at + op.length).trim().replace(/,/g, "");
    const get = FIELDS[key];
    const n = Number(rest);
    if (!get || rest === "" || Number.isNaN(n)) break;   // 못 알아들으면 글자 검색으로
    return (s, mode) => {
      const v = get(s, mode);
      return v != null && compare(v, op, n);
    };
  }

  return (s) => haystack(s).includes(lower);
}

/**
 * 질의를 술어로 바꾼다. 빈 질의는 모두 통과다.
 *
 * 따옴표는 다루지 않는다. 상호에 공백이 있어도 `대복 주유소` 처럼 나눠 쓰면 두
 * 낱말이 모두 걸려 결국 같은 곳이 남는다.
 */
export function compileQuery(q: string): (s: StationSignal, mode: ViewMode) => boolean {
  const terms = q.split(/\s+/).filter(Boolean).map(parseTerm);
  if (terms.length === 0) return () => true;
  return (s, mode) => terms.every((t) => t(s, mode));
}

/** 검색 상자 도움말에 쓸 보기. */
export const QUERY_HINT = "이름·지역, 9차, 계수<1, 순위<=5, 휘발유<1700, 적합, 셀프";
