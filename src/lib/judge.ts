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
 * 바뀌는데, 전국 주유소 원본은 화면에 없다. 대신 시·도별 서로 다른 가격을
 * 모두 싣는다(`BoardData.cutoffs`). 허용된 설정 전체에서 분모를 다시 구한다.
 *
 * ## 무엇이 안 되나
 *
 * 기존 40개 제한 자료에서 새 순위의 분모를 알 수 없으면 계수를 비워 둔다.
 */
import { basisSido } from "./region.ts";
import { coefficientOf, greenRankWith, toSignal } from "./signal.ts";
import { driftSignalOf, worseOf } from "./adjust.ts";
import type {
  AdjustedCombine, BoardData, JudgeMode, SignalColor, StationSignal, ViewMode,
} from "./types.ts";
import { emptyCounts, VIEW_MODES } from "./types.ts";

/**
 * 기존 파일의 잘림 여부를 해석하는 호환용 상한. 새 파일에는 제한이 없다.
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

/** 오름차순 서로 다른 가격을 모두 싣는다. 주유소별 원본 행은 포함하지 않는다. */
export function cutoffsOf(distinct: number[]): number[] {
  return [...distinct];
}

/**
 * 그 순위의 커트라인.
 *
 * 서로 다른 값이 기준 순위보다 적으면 마지막 값을 쓴다 — `greenBaseOf()` 와
 * 같은 규칙이다. 다만 여기 실린 목록은 K개에서 잘렸을 수 있으므로, **자른
 * 자리보다 뒤를 물으면 모른다고 답한다.** 잘린 끝을 지역의 마지막 값으로
 * 착각하면 커트라인이 실제보다 훨씬 싸게 나온다.
 */
export function baseAt(cut: number[] | undefined, rank: number, complete = false): number | null {
  if (!Number.isInteger(rank) || rank < 1) return null;
  if (!cut || cut.length === 0) return null;
  if (rank <= cut.length) return cut[rank - 1];
  return complete || cut.length < CUTOFF_K ? cut[cut.length - 1] : null;
}

/** 보정 기준선 유무와 무관하게 선정 취소 조건을 우선한다. */
export function adjustedSignalOf(st: StationSignal): SignalColor {
  return st.overRegion?.cancel ? "cancel" : st.adjusted?.signal ?? "unknown";
}

function tally(stations: StationSignal[], pick: (s: StationSignal) => SignalColor) {
  const out = emptyCounts();
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
    const basis = basisSido(st.sido, st.sigungu, board.date);
    // 기준 순위는 집계와 같은 잣대로 고른다 — 오피넷 소재 시·도를 본다.
    const greenRank = greenRankWith(basis, j);

    // ── 세 기준(통합·휘발유·경유) ──────────────────────────────────
    const metrics = {} as StationSignal["metrics"];
    for (const mode of VIEW_MODES) {
      const m = st.metrics?.[mode];
      if (!m) continue;
      const greenBase = baseAt(board.cutoffs?.[basis]?.[mode], greenRank, board.cutoffsComplete)
        ?? (greenRank === st.greenRank ? m.greenBase : null);
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
      const greenBase = baseAt(board.adjustedCutoffs?.[basis], greenRank, board.cutoffsComplete)
        ?? (greenRank === st.greenRank ? a.greenBase : null);
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

    // 선정 취소 대상은 다른 무엇보다 앞선다. 오늘 순위가 어떻든 선정 자체를
    // 다시 볼 일이기 때문이다. 집계도 같은 차례로 덮는다 — aggregate.ts 참고.
    //
    // 이 표시는 임계값과 무관하다. 관리 화면에서 기준 순위를 바꿔도 '선정
    // 이후 지역 평균을 넘긴 날' 은 그대로라, 집계가 정해 둔 값을 그대로 쓴다.
    if (st.overRegion?.cancel) {
      for (const mode of VIEW_MODES) if (metrics[mode]) metrics[mode].signal = "cancel";
      if (adjusted) adjusted = { ...adjusted, signal: "cancel" };
    }

    const m = metrics.sum ?? st.metrics?.sum;
    const shown = st.overRegion?.cancel ? "cancel"
      : j.judgeMode === "adjusted" ? (adjusted?.signal ?? "unknown") : m.signal;

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
      adjustedCounts: tally(stations, adjustedSignalOf),
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
