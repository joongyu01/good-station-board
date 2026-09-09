import { useEffect, useRef, useState } from "react";
import type { History } from "@shared/lib/history.ts";
import { fetchData, sidoLabel } from "../lib/board.ts";

const dateLabel = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** 선정 취소 비교에 실제 사용하는 일별 단위지역 평균 합계. */
export default function RegionMeanWindow({ date, sido, onClose }: { date: string; sido: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [day, setDay] = useState(date);
  const [region, setRegion] = useState(sido);
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
  const regions = Object.keys(history?.regionMean ?? {}).sort((a, b) => a.localeCompare(b, "ko-KR"));
  const active = region && regions.includes(region) ? region : regions[0] ?? null;
  return <dialog ref={dialog} className="cancel-report mean-report" aria-labelledby="mean-title"
    onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="cancel-report-content">
      <header><h3 id="mean-title">단위지역 평균가격 검증</h3>
        <button type="button" autoFocus onClick={onClose} aria-label="평균가격 검증 닫기">✕</button></header>
      <p>선정 취소 대상 판정과 ‘단위지역 평균값 비교’ 그래프에 사용하는 일별 평균입니다.</p>
      <p className="muted">단위지역 내 휘발유·경유 가격이 모두 있는 전체 주유소의 합계가격을 산술평균합니다. 착한주유소만의 평균이 아닙니다. 광주·전남은 비교 모집단에 따라 별도로 표시합니다.</p>
      <div className="rank-bar"><label>기준일
        <select value={day} disabled={!dates.length} onChange={e => setDay(e.target.value)}>
          {dates.map(d => <option key={d} value={d}>{dateLabel(d)}</option>)}
        </select></label>
        <label>단위지역
          <select value={active ?? ""} disabled={!regions.length} onChange={e => setRegion(e.target.value)}>
            {regions.map(r => <option key={r} value={r}>{sidoLabel(r)}</option>)}
          </select>
        </label>
      </div>
      {error ? <p role="alert">평균가격 데이터를 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.</p>
        : !history ? <p role="status">불러오는 중…</p>
        : !regions.length || !dates.length ? <p>확인할 단위지역 평균가격 데이터가 없습니다.</p>
        : <table className="rank-table mean-table">
          <thead><tr><th>단위지역</th><th className="num">평균 합계가격 <small>(휘발유+경유)</small></th></tr></thead>
          <tbody>{(active ? [active] : []).map(region => {
            const value = history.regionMean?.[region]?.[index];
            return <tr key={region}><td>{sidoLabel(region)}</td><td className="num">
              {value == null ? <span className="muted">가격정보 없음</span> : <>
                <b>{value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원</b>
                <small className="sum-price-note">(휘발유+경유)</small>
              </>}
            </td></tr>;
          })}</tbody>
        </table>}
      <p className="muted">각 유종의 원/L 가격을 더한 비교용 값입니다. 단일 유종 1L의 판매가격이 아닙니다.</p>
    </div>
  </dialog>;
}
