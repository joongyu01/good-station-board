/**
 * 판정 다시 내기 — 임계값을 바꿨을 때 **집계를 기다리지 않고** 화면에서 다시 판정한다.
 *
 * ## 왜 필요한가
 *
 * 임계값은 관리 화면에서 바꾸는데 판정은 하루 두 번 도는 집계가 낸다. 그래서
 * 설정을 저장하고도 현황판은 다음 집계까지 옛 판정을 보여줬다. 무엇을 바꿨는지
 * 확인하려면 반나절을 기다려야 했다는 뜻이다.
 *
 * ## 무엇이면 다시 낼 수 있나
 *
 * 판정에 필요한 것은 결국 **그 주유소의 순위**와 **그 지역의 커트라인** 둘이다.
 * 순위(`regionRank`·`adjusted.rank`)와 모집단 크기는 이미 집계가 실어 두었으니
 * 색은 그대로 다시 낼 수 있다.
 *
 * 문제는 계수다. 계수의 분모인 커트라인은 `N번째로 싼 값`이라 N이 바뀌면 같이
 * 바뀌는데, 전국 1만 건 분포는 화면에 없다. 그래서 집계가 시·도별로 **1위부터
 * CUTOFF_K위까지의 커트라인**을 함께 싣는다(`BoardData.cutoffs`). 16개 시·도 ×
 * 3기준 × 40개라 12KB 남짓이고, 이것만 있으면 N을 어디로 옮기든 계수를 정확히
 * 다시 낼 수 있다.
 *
 * ## 무엇이 안 되나
 *
 * N이 CUTOFF_K를 넘으면 그 지역 커트라인을 알 수 없다. 그때는 계수만 집계가
 * 낸 값을 그대로 두고 색은 다시 낸다 — 순위는 알고 있기 때문이다.
 */
import { basisSido } from "./region.ts";
import { coefficientOf, greenRankWith, toSignal } from "./signal.ts";
import { driftSignalOf, worseOf } from "./adjust.ts";
import type {
  AdjustedCombine, BoardData, JudgeMode, SignalColor, StationSignal, ViewMode,
} from "./types.ts";
import { VIEW_MODES } from "./types.ts";

/**
 * 시·도마다 실어 둘 커트라인 개수.
 *
 * 관리 화면이 허용하는 기준 순위는 1~500이지만, 실제로 쓰는 값은 서울·경기 10과
 * 그 밖 5다. 근접 경계(2N)까지 봐도 20이면 충분하고, 여유를 둬 40으로 잡았다.
 * 이 값을 키우면 latest.json 이 시·도당 3×(늘어난 수)개씩 커진다.
 */
export const CUTOFF_K = 40;

/** 관리 화면에서 내려오는 판정 설정. `Thresholds` 에서 판정에 쓰는 것만 추린 것. */
export interface Judging {
  rankGreenMetro: number;
  rankGreenDefault: number;
  rankYellowFactor: number;
  judgeMode: JudgeMode;
  adjustedCombine: AdjustedCombine;
  driftGreen: number;
  driftYellow: number;
}

/** 오름차순 서로 다른 값에서 앞쪽 K개만 잘라 낸다. 집계가 부른다. */
export function cutoffsOf(distinct: number[], k = CUTOFF_K): number[] {
  return distinct.slice(0, k);
}

/**
 * 그 순위의 커트라인.
 *
 * 서로 다른 값이 기준 순위보다 적으면 마지막 값을 쓴다 — `greenBaseOf()` 와
 * 같은 규칙이다. 다만 여기 실린 목록은 K개에서 잘렸을 수 있으므로, **자른
 * 자리보다 뒤를 물으면 모른다고 답한다.** 잘린 끝을 지역의 마지막 값으로
 * 착각하면 커트라인이 실제보다 훨씬 싸게 나온다.
 */
export function baseAt(cut: number[] | undefined, rank: number): number | null {
  if (!cut || cut.length === 0) return null;
  if (rank <= cut.length) return cut[rank - 1];
  return cut.length < CUTOFF_K ? cut[cut.length - 1] : null;
}

function tally(stations: StationSignal[], pick: (s: StationSignal) => SignalColor) {
  const out: Record<SignalColor, number> = {
    green: 0, yellow: 0, red: 0, unknown: 0, stale: 0,
  };
  for (const s of stations) out[pick(s)]++;
  return out;
}

/**
 * 설정을 자료에 입힌다.
 *
 * 집계가 낸 순위와 커트라인 표 위에서 색·계수를 다시 내고, 요약까지 새로 센다.
 * 화면 곳곳이 `signal` 하나만 보게 여기서 한 번에 갈아 끼운다 — 지도·목록·요약·
 * 거르기가 저마다 설정을 따지게 두면 한 군데는 반드시 어긋난다.
 */
export function applyJudging(board: BoardData, j: Judging): BoardData {
  const f = j.rankYellowFactor;

  const stations = board.stations.map((st): StationSignal => {
    const basis = basisSido(st.sido, st.sigungu);
    // 기준 순위는 집계와 같은 잣대로 고른다 — 오피넷 소재 시·도를 본다.
    const greenRank = greenRankWith(st.sido, j);

    // ── 세 기준(통합·휘발유·경유) ──────────────────────────────────
    const metrics = {} as StationSignal["metrics"];
    for (const mode of VIEW_MODES) {
      const m = st.metrics?.[mode];
      if (!m) continue;
      const greenBase = baseAt(board.cutoffs?.[basis]?.[mode], greenRank) ?? m.greenBase;
      const idx = coefficientOf(m.price, greenBase);
      metrics[mode] = {
        ...m,
        greenBase: idx?.regionBase ?? greenBase,
        coefficient: idx?.coefficient ?? null,
        signal: toSignal(m.regionRank, greenRank, f, m.regionN),
      };
    }

    // ── 보정 판정 ────────────────────────────────────────────────────
    const a = st.adjusted;
    let adjusted = a;
    if (a) {
      const greenBase = baseAt(board.adjustedCutoffs?.[basis], greenRank) ?? a.greenBase;
      const idx = coefficientOf(st.sum, greenBase);
      const rankSignal = toSignal(a.rank, greenRank, f, a.regionN);
      const driftSignal = driftSignalOf(a.drift, j.driftGreen, j.driftYellow);
      adjusted = {
        ...a,
        greenBase: idx?.regionBase ?? greenBase,
        coefficient: idx?.coefficient ?? null,
        rankSignal,
        driftSignal,
        signal:
          j.adjustedCombine === "drift" ? driftSignal
          : j.adjustedCombine === "rank" ? rankSignal
          : worseOf(rankSignal, driftSignal),
      };
    }

    // ── 가격을 믿기 어려운 곳은 설정과 무관하다 ──────────────────────
    //
    // 오늘 값이 없어 못 잰 것과 과거에 거른 이력이 있는 것은 어느 임계값을
    // 골라도 그대로다. 집계가 세어 둔 결측 일수로 다시 판단한다.
    if (st.dataGapDays > 0) {
      const hasToday = st.prices?.gasoline != null && st.prices?.diesel != null;
      const mark: SignalColor = hasToday ? "stale" : "unknown";
      for (const mode of VIEW_MODES) if (metrics[mode]) metrics[mode].signal = mark;
      if (adjusted) adjusted = { ...adjusted, signal: mark };
    }

    const m = metrics.sum ?? st.metrics?.sum;
    const shown = j.judgeMode === "adjusted" ? (adjusted?.signal ?? "unknown") : m.signal;

    return {
      ...st,
      metrics,
      adjusted,
      greenRank,
      // metrics.sum 을 펼쳐 둔 값들. 기준 순위에 따라 바뀌는 것만 다시 넣는다.
      priceIndex: m.coefficient != null && m.greenBase != null && st.sum != null
        ? { sum: st.sum, regionBase: m.greenBase, coefficient: m.coefficient }
        : null,
      signal: shown,
    };
  });

  return {
    ...board,
    judgeMode: j.judgeMode,
    stations,
    summary: {
      ...board.summary,
      counts: tally(stations, (s) => s.signal),
      adjustedCounts: tally(stations, (s) => s.adjusted?.signal ?? "unknown"),
    },
    baseline: board.baseline
      ? {
          ...board.baseline,
          combine: j.adjustedCombine,
          driftGreen: j.driftGreen,
          driftYellow: j.driftYellow,
        }
      : null,
  };
}
