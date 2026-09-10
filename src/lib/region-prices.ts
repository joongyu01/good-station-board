import { basisSido } from './region.ts';

/** 화면 표시 순서: 수도권, 광역시·세종, 도. 인구 순위가 아니다. */
const REGION_ORDER=['서울','경기','인천','부산','대구','광주','대전','울산','세종','강원','충북','충남','전북','전남','전남광주','경북','경남','제주'];
export function compareRegionOrder(a:string,b:string){
  const index=(r:string)=>{const i=REGION_ORDER.indexOf(r);return i<0?999:i;};
  return index(a)-index(b)||a.localeCompare(b,'ko');
}

export interface PriceDistribution {
  n: number; mean: number; median: number; min: number; max: number;
  sd: number; q1: number; q3: number; cv: number;
}
export type RegionPrices = Record<string, Record<'gasoline' | 'diesel' | 'sum', PriceDistribution>>;
export interface RegionPriceHistory { version: 1; days: Record<string, RegionPrices> }
const round = (x: number) => Math.round(x * 100) / 100;
/** 선형 보간 분위수, 모집단 표준편차 (분모 N). */
export function distribution(values: number[]): PriceDistribution {
  if (!values.length) throw new Error('Empty price population');
  const sorted = [...values].sort((a,b)=>a-b), n=sorted.length;
  const mean=sorted.reduce((a,b)=>a+b,0)/n;
  const quantile=(p:number)=>{
    const pos=(n-1)*p, lo=Math.floor(pos), hi=Math.ceil(pos);
    return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);
  };
  const sd=Math.sqrt(sorted.reduce((s,x)=>s+(x-mean)**2,0)/n);
  return {n,mean:round(mean),median:round(quantile(.5)),min:sorted[0],max:sorted[n-1],
    sd:round(sd),q1:round(quantile(.25)),q3:round(quantile(.75)),cv:round(sd/mean*100)};
}
/** 취소 비교 평균과 동일한 모집단: 두 유종 가격이 모두 유효한 전체 주유소. */
export function buildRegionPrices(rows: Array<{sido:string;sigungu:string;gasoline:number|null;diesel:number|null}>, date:string):RegionPrices {
  const groups=new Map<string,{gasoline:number[];diesel:number[];sum:number[]}>();
  for(const r of rows){
    if(r.gasoline==null||r.diesel==null||r.gasoline<=0||r.diesel<=0)continue;
    const key=basisSido(r.sido,r.sigungu,date);
    const g=groups.get(key)??{gasoline:[],diesel:[],sum:[]};
    g.gasoline.push(r.gasoline);g.diesel.push(r.diesel);g.sum.push(r.gasoline+r.diesel);groups.set(key,g);
  }
  return Object.fromEntries([...groups].sort(([a],[b])=>a.localeCompare(b,'ko')).map(([region,g])=>[region,{
    gasoline:distribution(g.gasoline),diesel:distribution(g.diesel),sum:distribution(g.sum),
  }]));
}
