import { useEffect, useRef } from "react";
import type { OverDay } from "@shared/lib/history.ts";
import { CANCEL_MIN_OVER_DAYS } from "@shared/lib/types.ts";

const dateLabel = (d: string) => `${d.slice(0, 4)}년 ${Number(d.slice(4, 6))}월 ${Number(d.slice(6, 8))}일`;
const money = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

export default function CancellationReport({ name, region, since, to, days, onClose }: {
  name: string; region: string; since: string; to: string; days: OverDay[]; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  const exceeded = days.filter(d => d.over > 0).sort((a, b) => b.date.localeCompare(a.date));
  const first = exceeded.at(-1);
  const max = exceeded.reduce<OverDay | null>((m, d) => !m || d.over > m.over ? d : m, null);
  return <dialog ref={dialog} className="cancel-report" aria-labelledby="cancel-report-title"
    onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
    onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
    <div className="cancel-report-content">
      <header><h3 id="cancel-report-title">선정 취소 대상 사유 리포트</h3>
        <button type="button" autoFocus onClick={onClose} aria-label="리포트 닫기">✕</button></header>
      <h4>{name}</h4>
      <p>최초 선정 발표: {dateLabel(since)} · 비교 지역: {region}</p>
      <p>조회 범위: 선정 발표 다음 날부터 {dateLabel(to)}까지. 판매가 두 유종과 지역 평균이 모두 있는 {days.length}일을 비교했습니다.</p>
      <p className="cancel-report-rule">판정 조건: 하루 휘발유+경유 판매가 합계가 같은 날 단위지역 평균보다 높은 날이 {CANCEL_MIN_OVER_DAYS}일 이상이면 대상입니다.</p>
      <p><strong>평균 초과 {exceeded.length}일</strong>
        {first && <> · 최초 초과 {dateLabel(first.date)}</>}
        {max && <> · 최대 초과 +{money(max.over)}원 ({dateLabel(max.date)})</>}</p>
      <p className="muted">현황판 기준에 따른 검토 대상 표시이며, 실제 선정 취소 처분을 의미하지 않습니다. 계수·순위에 따른 ‘가격기준 초과’ 일수와는 다른 기준입니다. 가격 또는 평균이 없는 날은 제외합니다.</p>
      <div className="cancel-report-table"><table>
        <thead><tr><th>초과 날짜</th><th>판매가 합계</th><th>단위지역 평균</th><th>초과액</th></tr></thead>
        <tbody>{exceeded.map(d => <tr key={d.date}>
          <th>{d.date.slice(0, 4)}.{d.date.slice(4, 6)}.{d.date.slice(6, 8)}</th><td>{money(d.sum)}원</td><td>{money(d.mean)}원</td><td>+{money(d.over)}원</td>
        </tr>)}</tbody>
      </table></div>
    </div>
  </dialog>;
}
