/** 주유소 목록 표. 패널 오른쪽에 들어간다. */
import type { StationSignal } from "../lib/board.ts";
import { SIGNAL_LABELS, formatPrice } from "../lib/board.ts";
import { nextSort, type SortDir, type SortKey, type SortState } from "../lib/table.ts";
import { VIEW_MODE_LABELS, type ViewMode } from "@shared/lib/types.ts";
import { BRAND_LABELS, withBrand } from "@shared/lib/brand.ts";

interface Props {
  /** 이미 정렬된 목록. 정렬은 App 이 한다 — CSV 도 같은 순서로 나가야 한다. */
  stations: StationSignal[];
  /** 지역 컬럼을 보여줄지 — 한 지역만 볼 때는 불필요하다 */
  showRegion?: boolean;
  emptyText?: string;
  /** 상호를 누르면 판매가 추이를 연다 */
  onSelect?: (s: StationSignal) => void;
  sort: SortState | null;
  onSort: (s: SortState | null) => void;
  /** 계수·순위 열이 어느 기준의 값인지 */
  mode: ViewMode;
}

interface HeaderDef {
  key: SortKey;
  label: string;
  num?: boolean;
  /** 지역 열은 한 지역만 볼 때 감춘다 */
  regionOnly?: boolean;
  /** 처음 눌렀을 때 방향 */
  first?: SortDir;
  title?: string;
}

function headers(mode: ViewMode): HeaderDef[] {
  const of = mode === "sum" ? "휘발유+경유 합계" : `${VIEW_MODE_LABELS[mode]} 가격`;
  return [
    { key: "signal", label: "", title: "신호등 — 상위권부터" },
    { key: "name", label: "주유소" },
    { key: "region", label: "지역", regionOnly: true },
    { key: "gasoline", label: "휘발유", num: true },
    { key: "diesel", label: "경유", num: true },
    {
      key: "coefficient", label: "계수", num: true,
      title: `${of}를 그 시·도의 상위권 커트라인으로 나눈 값. 1.000 이하가 상위권`,
    },
    {
      key: "rank", label: "시·도 순위", num: true,
      title: `그 시·도에서 ${of} 기준 순위`,
    },
    {
      key: "regionMin", label: "시·도 최저", num: true,
      title: `그 시·도에서 실제로 가장 싼 ${mode === "sum" ? "합계" : VIEW_MODE_LABELS[mode] + " 가격"}`,
    },
  ];
}

export default function StationTable({
  stations, showRegion, emptyText, onSelect, sort, onSort, mode,
}: Props) {
  if (stations.length === 0) {
    return <p className="empty">{emptyText ?? "표시할 주유소가 없습니다."}</p>;
  }

  return (
    <table className="station-table">
      <thead>
        <tr>
          {headers(mode).filter((h) => !h.regionOnly || showRegion).map((h) => {
            const active = sort?.key === h.key;
            const dir = active ? sort!.dir : null;
            return (
              <th
                key={h.key}
                className={`${h.num ? "num" : ""}${h.key === "signal" ? " col-sig" : ""}`}
                aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
              >
                <button
                  type="button"
                  className={`th-sort${active ? " is-active" : ""}`}
                  title={h.title ? `${h.title} · 눌러서 정렬` : "눌러서 정렬"}
                  onClick={() => onSort(nextSort(sort, h.key, h.first ?? "asc"))}
                >
                  <span className="th-label">{h.label}</span>
                  <span className="th-arrow" aria-hidden="true">
                    {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}
                  </span>
                </button>
              </th>
            );
          })}
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
              ? `${mode === "sum" ? "휘발유+경유" : VIEW_MODE_LABELS[mode]} ${s.priceIndex.sum.toLocaleString("ko-KR")}원`
                + ` / 시·도 상위권 커트라인 ${s.priceIndex.regionBase.toLocaleString("ko-KR")}원`
              : "이 유종을 취급하지 않아 산출 불가"}>
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
