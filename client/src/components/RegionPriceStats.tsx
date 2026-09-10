import { useEffect, useState } from 'react';
import type { RegionPriceHistory } from '@shared/lib/region-prices.ts';
import { fetchData, formatDate } from '../lib/board.ts';

const number=(v:number)=>v.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function RegionPriceStats({date}:{date:string}){
  const [data,setData]=useState<RegionPriceHistory|null>(null);
  const [error,setError]=useState(false),[day,setDay]=useState(date);
  const [fuel,setFuel]=useState<'gasoline'|'diesel'|'sum'|'all'>('all');
  useEffect(()=>{
    const abort=new AbortController();
    fetchData('region-prices.json').then(r=>{if(!r.ok)throw new Error('fetch');return r.json();})
      .then((d:RegionPriceHistory)=>{if(!abort.signal.aborted){setData(d);if(!d.days[date])setDay(Object.keys(d.days).sort().at(-1)??'');}})
      .catch(()=>{if(!abort.signal.aborted)setError(true);});
    return()=>abort.abort();
  },[date]);
  const dates=Object.keys(data?.days??{}).sort().reverse();
  const regions=Object.entries(data?.days[day]??{});
  const fuels=fuel==='all'?['gasoline','diesel'] as const:[fuel] as const;
  const names={gasoline:'휘발유',diesel:'경유',sum:'합계 (휘발유+경유)'};
  return <section className="stats-panel region-price-stats">
    <h2>단위지역별 가격 현황</h2>
    <p>착한주유소만이 아닌, 두 유종 가격이 모두 유효한 전체 주유소 모집단입니다. 가격·표준편차는 원/L이며 합계는 비교용 휘발유+경유 값입니다.</p>
    <div className="rank-bar"><label>가격 기준일 <select aria-label="가격 기준일" value={day} disabled={!dates.length} onChange={e=>setDay(e.target.value)}>{dates.map(d=><option key={d} value={d}>{formatDate(d)}</option>)}</select></label>
      <label>유종 <select aria-label="유종" value={fuel} onChange={e=>setFuel(e.target.value as typeof fuel)}><option value="all">휘발유·경유 모두</option><option value="gasoline">휘발유</option><option value="diesel">경유</option><option value="sum">합계 (휘발유+경유)</option></select></label></div>
    {error?<p role="alert">가격 통계를 불러오지 못했습니다. 새로고침해 주세요.</p>:!data?<p role="status">가격 통계 불러오는 중…</p>:<>
    <p>전국 비교 대상 {regions.reduce((n,[,r])=>n+r.gasoline.n,0).toLocaleString()}곳 · {regions.length}개 단위지역 · 6/30까지 광주·전남 별도, 7/1부터 통합</p>
    <div className="region-price-scroll" tabIndex={0} aria-label="단위지역 가격 통계 표, 좌우 스크롤 가능"><table>
      <thead><tr>{['단위지역','유종','주유소 수','평균','전국 평균차','중앙값','최저','최고','표준편차','중간 50% 범위','변동계수 (%)'].map(t=><th key={t}>{t}</th>)}</tr></thead>
      <tbody>{regions.flatMap(([region,stats])=>fuels.map(f=>{
        const s=stats[f], n=regions.reduce((v,[,r])=>v+r[f].n,0);
        const national=regions.reduce((v,[,r])=>v+r[f].mean*r[f].n,0)/n;
        const gap=s.mean-national;
        return <tr key={region+f}><th scope="row">{region}</th><td>{names[f]}</td><td>{s.n.toLocaleString()}</td><td><b>{number(s.mean)}</b></td><td>{gap>0?'+':''}{number(gap)}</td><td>{number(s.median)}</td><td>{number(s.min)}</td><td>{number(s.max)}</td><td>{number(s.sd)}</td><td>{number(s.q1)} ~ {number(s.q3)}</td><td>{number(s.cv)}</td></tr>;
      }))}</tbody></table></div>
    <p>전국 평균차: 주유소 수로 가중한 전국 평균과의 차이(지역 평균의 단순평균 아님). 양수면 전국보다 비쌉니다. 반올림으로 0.01원 오차가 있을 수 있습니다.</p>
    <p>표준편차: 같은 날 주유소 간 가격 산포, √(Σ(가격−평균)²/N). 클수록 지역 내 가격 차이가 큽니다. 중간 50% 범위는 25~75백분위(선형 보간), 변동계수는 표준편차÷평균×100입니다. 시간에 따른 가격 변동성이나 선정 취소 여부를 뜻하지 않습니다.</p>
    </>}
  </section>;
}
