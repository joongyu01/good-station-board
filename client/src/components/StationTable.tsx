/** 주유소 목록 표. 패널 오른쪽에 들어간다. */
import type { StationSignal } from "../lib/board.ts";
import { SIGNAL_LABELS, formatDiff, formatPrice } from "../lib/board.ts";

interface Props {
  stations: StationSignal[];
  /** 지역 컬럼을 보여줄지 — 한 지역만 볼 때는 불필요하다 */
  showRegion?: boolean;
  emptyText?: string;
}

export default function StationTable({ stations, showRegion, emptyText }: Props) {
  if (stations.length === 0) {
    return <p className="empty">{emptyText ?? "표시할 주유소가 없습니다."}</p>;
  }

  return (
    <table className="station-table">
      <thead>
        <tr>
          <th className="col-sig" aria-label="신호등"></th>
          <th>주유소</th>
          {showRegion && <th>지역</th>}
          <th className="num">판매가</th>
          <th className="num">지역평균</th>
          <th className="num">편차</th>
          <th className="num">지역순위</th>
        </tr>
      </thead>
      <tbody>
        {stations.map((s) => (
          <tr key={`${s.seq}-${s.fuelType}`} className={`row-${s.signal}`}>
            <td className="col-sig">
              <span className={`dot dot-${s.signal}`} title={SIGNAL_LABELS[s.signal]} />
            </td>
            <td className="col-name">
              <span className="name">{s.name}</span>
              {s.isRegionLowest && <span className="badge badge-low">지역최저가</span>}
              {s.lowSample && (
                <span className="badge badge-warn" title="관내 주유소가 적어 시·도 표준편차로 판정했습니다">
                  표본부족
                </span>
              )}
              {!s.stationId && (
                <span className="badge badge-warn" title="Opinet 주유소 코드를 찾지 못해 가격을 붙이지 못했습니다">
                  미매칭
                </span>
              )}
            </td>
            {showRegion && <td className="col-region">{s.sigungu}</td>}
            <td className="num">{formatPrice(s.price)}</td>
            <td className="num muted">{formatPrice(s.regionMean)}</td>
            <td className={`num diff ${s.diff == null ? "" : s.diff < 0 ? "neg" : "pos"}`}>
              {formatDiff(s.diff)}
            </td>
            <td className="num muted">
              {s.regionRank == null ? "—" : `${s.regionRank} / ${s.regionN}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
