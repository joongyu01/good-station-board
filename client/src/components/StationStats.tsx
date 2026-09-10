import { BRAND_LABELS } from "@shared/lib/brand.ts";
import { LOYAL_ROUNDS } from "@shared/lib/types.ts";
import { basisSido } from "@shared/lib/region.ts";
import { formatDate, SIGNAL_LABELS, type BoardData } from "../lib/board.ts";
import RegionPriceStats from './RegionPriceStats.tsx';
import { compareRegionOrder } from '@shared/lib/region-prices.ts';

function groups(values: string[]) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
}

export default function StationStats({ board }: { board: BoardData }) {
  const stations = board.stations, total = stations.length;
  const rounds = groups(stations.flatMap(s => [...new Set(s.rounds ?? [])]))
    .sort((a,b) => parseInt(a[0])-parseInt(b[0]));
  const regions = groups(stations.map(s => basisSido(s.sido, s.sigungu, board.date))).sort(([a],[b])=>compareRegionOrder(a,b));
  const brands = groups(stations.map(s => s.brand ? BRAND_LABELS[s.brand] : "상표 미등록"));
  const recurrence = groups(stations.map(s => `${new Set(s.rounds ?? []).size}회 선정`));
  const current = groups(stations.map(s => SIGNAL_LABELS[s.signal]));
  const cancel = stations.filter(s => s.overRegion?.cancel).length;
  function table(title: string, rows: [string, number][], note?: string) {
    return <section className="stats-panel"><h2>{title}</h2>{note && <p>{note}</p>}
      <table><thead><tr><th>구분</th><th>업체 수</th><th>전체 대비</th></tr></thead>
        <tbody>{rows.map(([label,n]) => <tr key={label}><th scope="row">{label}</th><td>{n.toLocaleString()}</td>
          <td><span className="stats-bar" style={{ width: `${total ? n/total*100 : 0}%` }} />{total ? (n/total*100).toFixed(1) : "0.0"}%</td></tr>)}</tbody></table>
    </section>;
  }
  return <main className="stats-page">
    <header><a href="#">← 현황판</a><h1>착한주유소 통계</h1>
      <p>현재 배포된 명단 기준 · 가격·지역 구분 기준일: {formatDate(board.date)}</p>
      <p>주유소 지점 단위의 업체 수입니다. 실시간 신규 선정·취소를 확인한 공식 총계는 아닙니다.</p></header>
    <div className="stats-kpis">
      {[['등록 주유소',total],['단위지역',regions.length],['셀프',stations.filter(s=>s.isSelf === true).length],
        ['착하디착한',stations.filter(s=>new Set(s.rounds).size>=LOYAL_ROUNDS).length],['선정 취소 검토 대상',cancel]]
        .map(([label,n])=><div key={label}><span>{label}</span><strong>{n}곳</strong></div>)}
    </div>
    <div className="stats-grid">
      {table('차수별 선정 현황',rounds,'현재 명단에 남아 있는 주유소의 선정 이력입니다. 여러 차수에 선정된 곳은 차수마다 집계되므로 합계가 전체보다 큽니다. 과거 차수의 공식 전체 선정 수와는 다를 수 있습니다.')}
      {table('단위지역별 현황',regions,'가격 기준일의 행정구역 정책을 적용합니다. 7/1 이후 전남·광주는 통합 집계합니다.')}
      {table('상표별 현황',brands)}
      {table('반복 선정 횟수',recurrence,`서로 다른 차수 ${LOYAL_ROUNDS}회 이상 선정된 주유소는 착하디착한으로 분류합니다.`)}
      {table('셀프 운영 여부',groups(stations.map(s=>s.isSelf === true ? '셀프' : s.isSelf === false ? '일반' : '정보 없음')))}
      {table('현재 판정 분포',current,`저장된 판정 방식 기준. 선정 취소 검토 대상 ${cancel}곳은 현재 판정과 별도로 중복 집계하며, 실제 선정 취소를 의미하지 않습니다.`)}
    </div>
    <RegionPriceStats date={board.date} stations={stations} />
  </main>;
}
