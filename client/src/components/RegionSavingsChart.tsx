import { useEffect, useMemo, useRef, useState } from 'react';
import type { History } from '@shared/lib/history.ts';
import type { StationSignal } from '@shared/lib/types.ts';
import { compareRegionOrder, type RegionPriceHistory } from '@shared/lib/region-prices.ts';
import { compareGoodPrices } from '@shared/lib/good-price-comparison.ts';
import { formatDate } from '../lib/board.ts';

const COLORS=['#1763aa','#a0429b','#258545','#cb6825','#6654c0','#be4155','#00888e','#897124','#617586','#a34e2b','#4a80be','#8972ab','#61862d','#bd547a','#30736c','#a38045','#394e99','#7b563e'];
const timestamp=(d:string)=>Date.UTC(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8));
const W=1000,H=330,L=55,R=20,T=18,B=35;
export default function RegionSavingsChart({data,history,stations,onClose}:{data:RegionPriceHistory;history:History;stations:StationSignal[];onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [mode,setMode]=useState<'savings'|'distribution'>('savings');
  const [metric,setMetric]=useState<'sd'|'mean'|'median'|'range'|'iqr'|'cv'>('sd');
  const metricNames={sd:'표준편차',mean:'평균가격',median:'중앙값',range:'최고−최저 가격차',iqr:'중간 50% 가격폭',cv:'변동계수'};
  const unit=mode==='savings'||metric==='cv'?'%':'원/L';
  useEffect(()=>{const node=dialog.current!;const overflow=document.body.style.overflow;node.showModal();document.body.style.overflow='hidden';return()=>{node.close();document.body.style.overflow=overflow;};},[]);
  const available=useMemo(()=>Object.keys(data.days).sort(),[data]);
  const [from,setFrom]=useState(available[0]??''),[to,setTo]=useState(available.at(-1)??'');
  const [fuel,setFuel]=useState<'gasoline'|'diesel'|'sum'>('gasoline');
  const [hidden,setHidden]=useState<string[]>([]),[hover,setHover]=useState<string|null>(null);
  // 하루에 최대 472곳을 한 번 비교. 마우스 이동에는 이 계산을 반복하지 않는다.
  const series=useMemo(()=>available.map(date=>({date,values:compareGoodPrices(stations,history,date,data.days[date])})),[available,data,history,stations]);
  const days=useMemo(()=>series.filter(d=>d.date>=from&&d.date<=to),[series,from,to]);
  const byDate=useMemo(()=>new Map(series.map(d=>[d.date,d.values])),[series]);
  const regions=useMemo(()=>[...new Set(days.flatMap(d=>Object.keys(data.days[d.date])))].sort(compareRegionOrder),[days,data]);
  function valueAt(date:string,region:string){
    if(mode==='savings'){
      const c=byDate.get(date)?.[region]?.[fuel];
      return c?{value:c.percent,n:c.n}:null;
    }
    const s=data.days[date]?.[region]?.[fuel];
    return s?{value:metric==='range'?s.max-s.min:metric==='iqr'?s.q3-s.q1:s[metric],n:s.n}:null;
  }
  const geometry=useMemo(()=>{
    const values=days.flatMap(d=>regions.filter(r=>!hidden.includes(r)).flatMap(r=>valueAt(d.date,r)?.value??[]));
    const low=mode==='savings'?Math.min(0,...values):values.length?Math.min(...values):0,high=values.length?Math.max(mode==='savings'?0:-Infinity,...values):1,pad=Math.max(.5,(high-low)*.12);
    const min=low-pad,max=high+pad;
    const first=timestamp(from),last=timestamp(to);
    const x=(date:string)=>L+(last===first?(W-L-R)/2:(timestamp(date)-first)/(last-first)*(W-L-R));
    const y=(v:number)=>T+(max-v)/(max-min)*(H-T-B);
    return {x,y,ticks:Array.from({length:5},(_,i)=>min+(max-min)*i/4),paths:regions.map(region=>{
      let path='',previous:number|null=null;
      const points: Array<{date:string;x:number;y:number;value:number}>=[];
      for(const d of days){
        const value=valueAt(d.date,region)?.value;
        if(value==null){previous=null;continue;}
        const now=timestamp(d.date),px=x(d.date),py=y(value);
        path+=`${previous!=null&&now-previous===86400000?'L':'M'}${px.toFixed(2)},${py.toFixed(2)} `;
        points.push({date:d.date,x:px,y:py,value});previous=now;
      }
      return {region,path,points};
    })};
  },[days,regions,fuel,hidden,from,to,mode,metric,series,data]);
  const selected=days.find(d=>d.date===hover)??days.at(-1);
  function pick(clientX:number,rect:DOMRect){
    const px=(clientX-rect.left)/rect.width*W;
    const target=timestamp(from)+(px-L)/(W-L-R)*(timestamp(to)-timestamp(from));
    const nearest=days.reduce<typeof days[number]|null>((best,d)=>!best||Math.abs(timestamp(d.date)-target)<Math.abs(timestamp(best.date)-target)?d:best,null);
    if(nearest)setHover(nearest.date);
  }
  return <dialog ref={dialog} className="cancel-report region-trend-modal" aria-labelledby="savings-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="cancel-report-content">
    <header><h3 id="savings-title">단위지역별 가격 시계열</h3><button type="button" autoFocus aria-label="시계열 그래프 닫기" onClick={onClose}>✕</button></header>
    <div className="trend-tabs" role="tablist" aria-label="시계열 종류">
      <button type="button" role="tab" aria-selected={mode==='savings'} onClick={()=>setMode('savings')}>절감률</button>
      <button type="button" role="tab" aria-selected={mode==='distribution'} onClick={()=>setMode('distribution')}>분포</button>
    </div>
    <h4>{mode==='savings'?'착한주유소 절감률':`전체 주유소 가격 분포 · ${metricNames[metric]}`} 추이</h4>
    <div className="rank-bar">
      <label>시작일 <select aria-label="절감률 시작일" value={from} onChange={e=>{setFrom(e.target.value);if(e.target.value>to)setTo(e.target.value);setHover(null);}}>{available.map(d=><option key={d} value={d}>{formatDate(d)}</option>)}</select></label>
      <label>종료일 <select aria-label="절감률 종료일" value={to} onChange={e=>{setTo(e.target.value);if(e.target.value<from)setFrom(e.target.value);setHover(null);}}>{available.map(d=><option key={d} value={d}>{formatDate(d)}</option>)}</select></label>
      <label>유종 <select aria-label="절감률 유종" value={fuel} onChange={e=>setFuel(e.target.value as typeof fuel)}><option value="gasoline">휘발유</option><option value="diesel">경유</option><option value="sum">합계 (휘발유+경유)</option></select></label>
      {mode==='distribution'&&<label>분포 지표 <select aria-label="분포 지표" value={metric} onChange={e=>setMetric(e.target.value as typeof metric)}>{Object.entries(metricNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
      <button type="button" className="btn-ghost" onClick={()=>setHidden([])}>전체 지역 표시</button>
    </div>
    <p>{mode==='savings'?'절감률 = (단위지역 전체 평균 − 착한주유소 평균) ÷ 전체 평균 × 100. 양수는 저렴, 음수는 비쌈입니다.':'두 유종 가격이 유효한 전체 주유소 기준입니다. 표준편차는 매일 지역 내 주유소 가격의 산포(N 기준), 중간 50% 가격폭은 Q3−Q1, 변동계수는 표준편차÷평균×100입니다. 지역별 시간 변동성 자체를 뜻하지 않습니다.'} 표의 날짜·유종 선택과 별도로 설정합니다.</p>
    <p className="trend-unit">단위: {unit}</p><div className="savings-plot-scroll">
      <svg className="savings-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={mode==='savings'?'전체 단위지역 착한주유소 절감률 추이':`전체 단위지역 ${metricNames[metric]} 추이`}>
        {geometry.ticks.map(t=><g key={t}><line x1={L} x2={W-R} y1={geometry.y(t)} y2={geometry.y(t)} stroke="#e0e8e2"/><text x={L-8} y={geometry.y(t)+4} textAnchor="end" fontSize="12">{t.toFixed(1)}{unit==='%'?'%':''}</text></g>)}
        {mode==='savings'&&<line x1={L} x2={W-R} y1={geometry.y(0)} y2={geometry.y(0)} stroke="#405044" strokeDasharray="5 4"/>}
        {geometry.paths.filter(p=>!hidden.includes(p.region)).map(p=><g key={p.region} data-region={p.region}>
          <path d={p.path} fill="none" stroke={COLORS[regions.indexOf(p.region)%COLORS.length]} strokeWidth="1.8"/>
          {p.points.map(v=><circle key={v.date} cx={v.x} cy={v.y} r={selected?.date===v.date?3:1.3} fill={COLORS[regions.indexOf(p.region)%COLORS.length]}/>)}
        </g>)}
        {[...new Set(Array.from({length:Math.min(6,days.length)},(_,i)=>Math.round(i*(days.length-1)/Math.max(1,Math.min(6,days.length)-1))))].map(i=><text key={days[i].date} x={geometry.x(days[i].date)} y={H-9} textAnchor="middle" fontSize="12">{days[i].date.slice(4,6)}/{days[i].date.slice(6,8)}</text>)}
        {selected&&<line x1={geometry.x(selected.date)} x2={geometry.x(selected.date)} y1={T} y2={H-B} stroke="#647267" strokeDasharray="3 4"/>}
        <rect x={L} y={T} width={W-L-R} height={H-T-B} fill="transparent" tabIndex={0} role="slider" aria-label="절감률 날짜 조회" aria-valuemin={1} aria-valuemax={Math.max(1,days.length)} aria-valuenow={Math.max(1,days.findIndex(d=>d.date===selected?.date)+1)} aria-valuetext={selected?formatDate(selected.date):'자료 없음'}
          onPointerMove={e=>pick(e.clientX,e.currentTarget.ownerSVGElement!.getBoundingClientRect())}
          onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=days.findIndex(d=>d.date===selected?.date);const next=e.key==='Home'?0:e.key==='End'?days.length-1:Math.max(0,Math.min(days.length-1,i+(e.key==='ArrowRight'?1:-1)));setHover(days[next]?.date??null);}}/>
      </svg>
    </div>
    <p><b>{selected?formatDate(selected.date):'선택 기간 자료 없음'}</b> · 그래프에 마우스를 올리거나 방향키로 일별 값을 확인하세요. 지역 이름을 누르면 해당 선을 숨기거나 표시합니다.</p>
    <div className="savings-legend">{regions.map((r,i)=>{
      const value=selected?valueAt(selected.date,r):null;
      return <button type="button" key={r} aria-pressed={!hidden.includes(r)} onClick={()=>setHidden(h=>h.includes(r)?h.filter(x=>x!==r):[...h,r])}>
        <i style={{background:COLORS[i%COLORS.length]}}/><b>{r}</b><span>{value?`${mode==='savings'&&value.value>0?'+':''}${value.value.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})}${unit} · ${value.n}곳`:'비교 자료 없음'}</span>
      </button>;
    })}</div>
    <p>{mode==='savings'?'현재 명단 중 각 날짜에 최초 선정 공시일 다음 날이 지난 주유소만 비교합니다. 선정·미신고에 따라 비교 업체 수가 달라지므로 같은 업체 고정 표본의 추이는 아닙니다. ':''}결측은 0으로 연결하지 않습니다. 광주·전남은 6/30까지 별도, 전남광주는 7/1부터 새 선으로 표시합니다.</p>
    </div>
  </dialog>;
}
