/** 주유소 목록 표. 패널 오른쪽에 들어간다. */
import type { StationSignal } from "../lib/board.ts";
import { SIGNAL_LABELS, formatPrice } from "../lib/board.ts";
import { BRAND_LABELS, withBrand } from "@shared/lib/brand.ts";

interface Props {
  stations: StationSignal[];
  /** 지역 컬럼을 보여줄지 — 한 지역만 볼 때는 불필요하다 */
  showRegion?: boolean;
  emptyText?: string;
  /** 상호를 누르면 판매가 추이를 연다 */
  onSelect?: (s: StationSignal) => void;
}

export default function StationTable({ stations, showRegion, emptyText, onSelect }: Props) {
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
          <th className="num">휘발유</th>
          <th className="num">경유</th>
          <th className="num" title="휘발유+경유 합계를 그 시·도의 초록불 커트라인으로 나눈 값. 1.000 이하가 상위권">계수</th>
          <th className="num" title="그 시·도에서 휘발유·경유를 모두 파는 주유소 중 합계 기준 순위">시·도 순위</th>
          <th className="num" title="그 시·도에서 실제로 가장 싼 합계">시·도 최저</th>
        </tr>
      </thead>
      <tbody>
        {stations.map((s) => (
          <tr key={s.seq} className={`row-${s.signal}`}>
            <td className="col-sig">
              <span className={`dot dot-${s.signal}`} title={SIGNAL_LABELS[s.signal]} />
            </td>
            <td className="col-name">
              <button
                type="button"
                className="name name-link"
                title={`${s.brand ? BRAND_LABELS[s.brand] + " · " : ""}판매가 추이 보기`}
                onClick={() => onSelect?.(s)}
              >
                {withBrand(s.name, s.brand)}
              </button>
              {s.isSelf && <span className="badge badge-self">셀프</span>}
              {s.isRegionLowest && <span className="badge badge-low">시·도 최저</span>}
              {!s.stationId && (
                <span className="badge badge-warn" title="Opinet 주유소 코드를 찾지 못해 가격을 붙이지 못했습니다">
                  미매칭
                </span>
              )}
            </td>
            {showRegion && <td className="col-region">{s.sigungu}</td>}
            <td className="num">{formatPrice(s.prices.gasoline)}</td>
            <td className="num">{formatPrice(s.prices.diesel)}</td>
            <td className="num idx" title={s.priceIndex
              ? `휘발유+경유 ${s.priceIndex.sum.toLocaleString("ko-KR")}원 / 시·도 상위권 커트라인 ${s.priceIndex.regionBase.toLocaleString("ko-KR")}원`
              : "휘발유·경유 중 하나를 취급하지 않아 산출 불가"}>
              {s.priceIndex ? s.priceIndex.coefficient.toFixed(3) : "—"}
            </td>
            <td className={`num rank ${s.regionRank == null ? "" : s.regionRank <= s.greenRank ? "in" : ""}`}>
              {s.regionRank == null ? "—" : `${s.regionRank.toLocaleString("ko-KR")} / ${s.regionN.toLocaleString("ko-KR")}`}
            </td>
            <td className="num muted">{formatPrice(s.regionMinSum)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
