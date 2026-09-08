/**
 * 계수 검증용 순위표.
 *
 * 계수는 `그 주유소 값 ÷ 그 시·도의 상위권 커트라인` 이다. 커트라인은 그날
 * 전국 1만 건을 시·도별로 줄 세운 뒤 N번째 값을 뽑은 것인데, 그 원본은
 * 저장소에 남기지 않는다(하루 4MB). 그래서 화면에서는 계수가 맞는지 확인할
 * 방법이 없었다.
 *
 * 여기서 시·도별 상위 몇 줄만 뽑아 따로 실어 둔다. 커트라인(N위·2N위)이 그
 * 안에 들어가야 "이 값이 왜 커트라인인지" 를 눈으로 확인할 수 있다.
 *
 * 자를 때 **행 수가 아니라 조밀 순위로 센다.** 예전에는 시·도마다 30행씩 실었는데
 * 동점이 많아 서울 30행이 조밀 10위까지밖에 못 갔다. 2N=20위 커트라인이 목록
 * 밖이라 정작 확인하려던 줄이 없었다. 순위로 자르면 동점이 몇이든 커트라인까지
 * 닿는다.
 */
import { basisSido } from "./region.ts";
import { cutoffsOf } from "./judge.ts";
import { distinctAsc, greenRankWith, type Thresholds } from "./signal.ts";
import { VIEW_MODES, type ViewMode } from "./types.ts";

/**
 * 시·도마다 실어 둘 조밀 순위. 2N(서울·경기 20위)보다 넉넉해야 커트라인 전후가 보인다.
 */
export const RANK_TOP_RANK = 25;

/**
 * 한 시·도·기준이 가질 수 있는 최대 행 수.
 *
 * 순위로만 자르면 경기처럼 동점이 몰리는 곳이 700행을 넘어 파일이 4메가가 된다.
 * 커트라인 전후를 보는 것이 목적이라 그렇게까지 필요하지 않다. 상한에 걸리면
 * 화면이 "여기까지만 실렸다" 고 밝힌다.
 */
export const RANK_MAX_ROWS = 120;

export interface RankRow {
  /** 순위. 같은 값이면 같은 순위 */
  r: number;
  stationId: string;
  name: string;
  sigungu: string;
  /** 그 기준의 값 — 통합이면 휘발유+경유 합계 */
  v: number;
  gasoline: number | null;
  diesel: number | null;
  /** 착한주유소면 true. 순위표 안에서 눈에 띄게 하려고 표시한다 */
  good: boolean;
}

export interface RankRegion {
  cutoffsComplete?: boolean;
  /** 그 기준으로 비교 가능한 주유소 수 (전국 원본 기준) */
  n: number;
  /** 실린 줄이 닿는 조밀 순위. 상한에 걸려 잘렸으면 RANK_TOP_RANK 보다 작다 */
  shownRank: number;
  greenRank: number;
  yellowRank: number;
  /** 계수 1 이 되는 값 */
  greenBase: number | null;
  /** 근접 경계값 */
  yellowBase: number | null;
  /**
   * 전체 순위의 커트라인(서로 다른 값).
   *
   * 위의 `greenBase`·`yellowBase` 는 만들 때의 기준 순위로 박힌 값이다. 관리
   * 화면에서 기준 순위를 바꾸면 현황판 계수는 바로 따라 움직이므로, 검증하러
   * 연 창이 화면과 어긋나지 않으려면 어느 순위든 커트라인을 찾을 수 있어야 한다.
   *
   * 실린 줄(상위 K건)에서 찾을 수도 있을 것 같지만 안 된다. 동점이 많으면
   * 30줄이 조밀 순위 열몇 위까지밖에 못 가 2N위가 목록 밖으로 나간다.
   */
  cutoffs: number[];
  rows: RankRow[];
}

export interface RankFile {
  date: string;
  generatedAt: string;
  /** 실으려 한 조밀 순위 */
  topRank: number;
  /** 시·도·기준마다의 행 수 상한 */
  maxRows: number;
  /** 시·도 → 기준 → 순위표 */
  regions: Record<string, Partial<Record<ViewMode, RankRegion>>>;
}

interface Row {
  stationId: string;
  stationName: string;
  sido: string;
  sigungu: string;
  gasoline: number | null;
  diesel: number | null;
}

/** 그 기준에서 이 행이 갖는 값. 없으면 null(순위에서 빠진다). */
function valueOf(r: Row, mode: ViewMode): number | null {
  const g = r.gasoline && r.gasoline > 0 ? r.gasoline : null;
  const d = r.diesel && r.diesel > 0 ? r.diesel : null;
  if (mode === "gasoline") return g;
  if (mode === "diesel") return d;
  return g != null && d != null ? g + d : null;
}

export function buildRanks(
  rows: Row[],
  goodIds: Set<string>,
  th: Thresholds,
  date: string,
  topRank = RANK_TOP_RANK,
  maxRows = RANK_MAX_ROWS,
): RankFile {
  const regions: RankFile["regions"] = {};

  for (const mode of VIEW_MODES) {
    // 시·도별로 모아 값 오름차순 정렬
    const bySido = new Map<string, Array<{ row: Row; v: number }>>();
    for (const r of rows) {
      const v = valueOf(r, mode);
      if (v == null) continue;
      // 순위는 비교 모집단 단위로 센다. 통합시는 옛 광주·전남으로 갈린다.
      const basis = basisSido(r.sido, r.sigungu);
      const arr = bySido.get(basis);
      if (arr) arr.push({ row: r, v }); else bySido.set(basis, [{ row: r, v }]);
    }

    for (const [sido, arr] of bySido) {
      arr.sort((a, b) => a.v - b.v || a.row.stationName.localeCompare(b.row.stationName, "ko-KR"));

      const greenRank = greenRankWith(sido, th);
      const yellowRank = greenRank * th.rankYellowFactor;
      // 커트라인도 **서로 다른 값** 기준이다. 조밀 순위와 같은 잣대여야 한다.
      const distinct = distinctAsc(arr.map((a) => a.v));
      const at = (k: number) => (distinct.length ? distinct[Math.min(k, distinct.length) - 1] : null);

      const out: RankRow[] = [];
      for (let i = 0; i < arr.length; i++) {
        const { row, v } = arr[i];
        // 조밀 순위 — 동점은 같은 등수, 다음 값은 바로 다음 등수.
        const r = i === 0 ? 1 : (arr[i - 1].v === v ? out[i - 1].r : out[i - 1].r + 1);
        // 순위로 자른다. 같은 등수는 통째로 넣거나 통째로 빼야 경계가 흐려지지 않는다.
        if (r > topRank) break;
        if (out.length >= maxRows && r !== out[out.length - 1].r) break;
        out.push({
          r,
          stationId: row.stationId,
          name: row.stationName,
          sigungu: row.sigungu,
          v,
          gasoline: row.gasoline,
          diesel: row.diesel,
          good: goodIds.has(row.stationId),
        });
      }

      (regions[sido] ??= {})[mode] = {
        n: arr.length,
        shownRank: out.length ? out[out.length - 1].r : 0,
        greenRank,
        yellowRank,
        greenBase: at(greenRank),
        yellowBase: at(yellowRank),
        cutoffs: cutoffsOf(distinct),
        cutoffsComplete: true,
        rows: out,
      };
    }
  }

  return { date, generatedAt: new Date().toISOString(), topRank, maxRows, regions };
}
