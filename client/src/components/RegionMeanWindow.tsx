import { useEffect, useRef, useState } from "react";
import type { History } from "@shared/lib/history.ts";
import { fetchData, sidoLabel } from "../lib/board.ts";

const dateLabel = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** 선정 취소 비교에 실제 사용하는 일별 단위지역 평균 합계. */
export default function RegionMeanWindow({ date, sido, onClose }: { date: string; sido: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [day, setDay] = useState(date);
  const region = sido;
  const [error, setError] = useState(false);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let alive = true;
    fetchData("history.json").then(r => {
      if (!r.ok) throw new Error(`history ${r.status}`);
      return r.json() as Promise<History>;
    }).then(h => {
      if (!alive) return;
      setHistory(h);
      if (!h.dates.includes(date)) setDay(h.dates.at(-1) ?? "");
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; node.close(); document.body.style.overflow = previous; };
  }, [date]);
  const dates = [...(history?.dates ?? [])].sort().reverse();
  const index = history?.dates.indexOf(day) ?? -1;
  const regions = Object.keys(history?.regionMean ?? {}).filter(r => history?.regionMean?.[r]?.[index] != null).sort((a, b) => a.localeCompare(b, "ko-KR"));
  const mapped = region === "전남광주" && day < "20260701" ? "광주"
    : (region === "광주" || region === "전남") && day >= "20260701" ? "전남광주" : region;
  const price = (value:number|null|undefined) => value == null ? '—' : value.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})+'원';
  return <dialog ref={dialog} className="cancel-report mean-report" aria-labelledby="mean-title"
    onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="cancel-report-content">
      <header><h3 id="mean-title">단위지역 평균가격 검증</h3>
        <button type="button" autoFocus onClick={onClose} aria-label="평균가격 검증 닫기">✕</button></header>
      <p>선택한 날짜의 모든 단위지역 평균을 나열합니다. 휘발유·경유 각각의 평균을 선정 취소 판정과 시계열 비교에 사용합니다.</p>
      <p className="muted">두 유종 가격이 모두 유효한 전체 주유소의 유종별 산술평균입니다. 착한주유소만의 평균이 아닙니다. 6/30까지 광주·전남 각각, 7/1부터 전남광주 통합 평균입니다. 금액은 원/L이며, 합계는 비교용입니다.</p>
      <div className="rank-bar"><label>기준일
        <select value={day} disabled={!dates.length} onChange={e => setDay(e.target.value)}>
          {dates.map(d => <option key={d} value={d}>{dateLabel(d)}</option>)}
        </select></label>
      </div>
      {error ? <p role="alert">평균가격 데이터를 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.</p>
        : !history ? <p role="status">불러오는 중…</p>
        : !regions.length || !dates.length ? <p>확인할 단위지역 평균가격 데이터가 없습니다.</p>
        : <table className="rank-table mean-table">
          <thead><tr><th>단위지역</th><th>휘발유 평균</th><th>경유 평균</th><th>평균 합계가격 <small>(휘발유+경유)</small></th></tr></thead>
          <tbody>{regions.map(r => <tr key={r} className={r===mapped || region==='전남광주' && day<'20260701' && (r==='광주'||r==='전남') ? 'mean-selected' : ''}>
            <th scope="row">{sidoLabel(r)}</th><td>{price(history.regionFuelMean?.g[r]?.[index])}</td><td>{price(history.regionFuelMean?.d[r]?.[index])}</td><td>{price(history.regionMean?.[r]?.[index])}</td>
          </tr>)}</tbody>
        </table>}
      <p className="muted">각 유종의 원/L 가격을 더한 비교용 값입니다. 단일 유종 1L의 판매가격이 아닙니다.</p>
    </div>
  </dialog>;
}
