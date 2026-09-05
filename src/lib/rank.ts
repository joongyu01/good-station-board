/**
 * 계수 검증용 순위표.
 *
 * 계수는 `그 주유소 값 ÷ 그 시·도의 상위권 커트라인` 이다. 커트라인은 그날
 * 전국 1만 건을 시·도별로 줄 세운 뒤 N번째 값을 뽑은 것인데, 그 원본은
 * 저장소에 남기지 않는다(하루 4MB). 그래서 화면에서는 계수가 맞는지 확인할
 * 방법이 없었다.
 *
 * 여기서 **시·도별 상위 K건**만 뽑아 따로 실어 둔다. 커트라인(N위·2N위)이
 * 그 안에 들어가므로 "이 값이 왜 커트라인인지" 를 눈으로 확인할 수 있다.
 * 전국을 다 실으면 하루 4MB 지만 K=30 이면 16개 시·도 × 3기준 × 30행이라
 * 100KB 안쪽이다.
 */
import { distinctAsc, greenRankWith, type Thresholds } from "./signal.ts";
import { VIEW_MODES, type ViewMode } from "./types.ts";

/** 시·도마다 실어 둘 상위 건수. 2N(서울·경기 20위)보다 넉넉해야 커트라인 전후가 보인다. */
export const RANK_TOP_K = 30;

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
  /** 그 기준으로 비교 가능한 주유소 수 (전국 원본 기준) */
  n: number;
  greenRank: number;
  yellowRank: number;
  /** 계수 1.000 이 되는 값 */
  greenBase: number | null;
  /** 근접 경계값 */
  yellowBase: number | null;
  rows: RankRow[];
}

export interface RankFile {
  date: string;
  generatedAt: string;
  topK: number;
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
  topK = RANK_TOP_K,
): RankFile {
  const regions: RankFile["regions"] = {};

  for (const mode of VIEW_MODES) {
    // 시·도별로 모아 값 오름차순 정렬
    const bySido = new Map<string, Array<{ row: Row; v: number }>>();
    for (const r of rows) {
      const v = valueOf(r, mode);
      if (v == null) continue;
      const arr = bySido.get(r.sido);
      if (arr) arr.push({ row: r, v }); else bySido.set(r.sido, [{ row: r, v }]);
    }

    for (const [sido, arr] of bySido) {
      arr.sort((a, b) => a.v - b.v || a.row.stationName.localeCompare(b.row.stationName, "ko-KR"));

      const greenRank = greenRankWith(sido, th);
      const yellowRank = greenRank * th.rankYellowFactor;
      // 커트라인도 **서로 다른 값** 기준이다. 조밀 순위와 같은 잣대여야 한다.
      const distinct = distinctAsc(arr.map((a) => a.v));
      const at = (k: number) => (distinct.length ? distinct[Math.min(k, distinct.length) - 1] : null);

      const out: RankRow[] = [];
      for (let i = 0; i < Math.min(topK, arr.length); i++) {
        const { row, v } = arr[i];
        // 조밀 순위 — 동점은 같은 등수, 다음 값은 바로 다음 등수.
        let r = i === 0 ? 1 : (arr[i - 1].v === v ? out[i - 1].r : out[i - 1].r + 1);
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
        greenRank,
        yellowRank,
        greenBase: at(greenRank),
        yellowBase: at(yellowRank),
        rows: out,
      };
    }
  }

  return { date, generatedAt: new Date().toISOString(), topK, regions };
}
