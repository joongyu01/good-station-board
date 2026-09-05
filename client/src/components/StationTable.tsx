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
  /** 모바일 미리보기 — 몇 줄만 보여주는 자리라 정렬 선택을 감춘다. */
  compact?: boolean;
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
    {
      key: "gasoline", label: "휘발유(지역순위)", num: true,
      title: "괄호 안은 그 시·도에서 휘발유 가격만 놓고 본 순위",
    },
    {
      key: "diesel", label: "경유(지역순위)", num: true,
      title: "괄호 안은 그 시·도에서 경유 가격만 놓고 본 순위",
    },
    {
      key: "coefficient", label: "계수", num: true,
      title: `${of}를 그 시·도의 상위권 커트라인으로 나눈 값. 1.000 이하가 상위권`,
    },
    {
      key: "rank", label: "시·도 순위", num: true,
      title: `그 시·도에서 ${of} 기준 순위`,
    },
  ];
}

export default function StationTable({
  stations, showRegion, emptyText, onSelect, sort, onSort, mode, compact,
}: Props) {
  if (stations.length === 0) {
    return <p className="empty">{emptyText ?? "표시할 주유소가 없습니다."}</p>;
  }

  const cols = headers(mode).filter((h) => !h.regionOnly || showRegion);

  return (
    <>
      {/*
        모바일에서는 표가 카드로 바뀌어 열 머리가 사라진다. 정렬을 통째로 잃지
        않도록 같은 상태를 쓰는 선택 상자를 둔다. PC 에서는 감춘다.
      */}
      <div className={`sort-mobile${compact ? " is-hidden" : ""}`}>
        <label>
          정렬
          <select
            value={sort ? `${sort.key}:${sort.dir}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) { onSort(null); return; }
              const [key, dir] = v.split(":") as [SortKey, SortDir];
              onSort({ key, dir });
            }}
          >
            <option value="">기본 순서</option>
            {cols.filter((h) => h.key !== "signal").map((h) => (
              <optgroup key={h.key} label={h.label}>
                <option value={`${h.key}:asc`}>{h.label} ↑</option>
                <option value={`${h.key}:desc`}>{h.label} ↓</option>
              </optgroup>
            ))}
          </select>
        </label>
      </div>

    <table className="station-table">
      <thead>
        <tr>
          {cols.map((h) => {
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
              {s.dataGapDays > 0 && (
                <span
                  className="badge badge-gap"
                  title={`최근 기록 중 ${s.dataGapDays}일치 가격이 비었거나 0원입니다. 값을 믿기 어려워 판정에서 뺐습니다.`}
                >
                  미신고 {s.dataGapDays}일
                </span>
              )}
              {!s.stationId && (
                <span className="badge badge-warn" title="Opinet 주유소 코드를 찾지 못해 가격을 붙이지 못했습니다">
                  미매칭
                </span>
              )}
            </td>
            {showRegion && <td className="col-region" data-label="지역">{s.sigungu}</td>}
            <td className="num" data-label="휘발유(지역순위)">
              {formatPrice(s.prices.gasoline)}
              <FuelRank rank={s.metrics?.gasoline?.regionRank ?? null} />
            </td>
            <td className="num" data-label="경유(지역순위)">
              {formatPrice(s.prices.diesel)}
              <FuelRank rank={s.metrics?.diesel?.regionRank ?? null} />
            </td>
            <td className="num idx" data-label="계수" title={s.priceIndex
              ? `${mode === "sum" ? "휘발유+경유" : VIEW_MODE_LABELS[mode]} ${s.priceIndex.sum.toLocaleString("ko-KR")}원`
                + ` / 시·도 상위권 커트라인 ${s.priceIndex.regionBase.toLocaleString("ko-KR")}원`
              : "이 유종을 취급하지 않아 산출 불가"}>
              {s.priceIndex ? s.priceIndex.coefficient.toFixed(3) : "—"}
            </td>
            <td data-label="시·도 순위"
              className={`num rank ${s.regionRank == null ? "" : s.regionRank <= s.greenRank ? "in" : ""}`}>
              {s.regionRank == null ? "—" : `${s.regionRank.toLocaleString("ko-KR")} / ${s.regionN.toLocaleString("ko-KR")}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

/**
 * 가격 옆 괄호 안 지역 순위.
 *
 * 그 유종만 놓고 본 시·도 순위다. 표의 '시·도 순위' 열은 지금 고른 기준(통합/
 * 휘발유/경유)의 순위라 값이 다를 수 있다 — 통합으로 보는 중이면 합산 순위다.
 */
function FuelRank({ rank }: { rank: number | null }) {
  if (rank == null) return null;
  return <span className="fuel-rank">({rank.toLocaleString("ko-KR")})</span>;
}
