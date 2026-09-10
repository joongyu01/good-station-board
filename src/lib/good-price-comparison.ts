import type { History } from './history.ts';
import type { StationSignal } from './types.ts';
import type { RegionPrices } from './region-prices.ts';
import { basisSido } from './region.ts';
import { ROUND_ANNOUNCED } from './adjust.ts';

export function compareGoodPrices(stations:StationSignal[],history:History,date:string,regions:RegionPrices){
  const index=history.dates.indexOf(date);
  const groups:Record<string,{gasoline:number[];diesel:number[];sum:number[]}>={};
  const seen=new Set<string>();
  if(index<0)return {};
  for(const station of stations){
    const id=station.stationId;
    const since=(station.rounds??[]).map(r=>ROUND_ANNOUNCED[r]).filter(Boolean).sort()[0];
    if(!id||seen.has(id)||!since||date<=since)continue;
    seen.add(id);
    const series=history.stations[id], g=series?.g[index], d=series?.d[index];
    if(g==null||d==null||g<=0||d<=0)continue;
    const key=basisSido(station.sido,station.sigungu,date);
    const group=groups[key]??={gasoline:[],diesel:[],sum:[]};
    group.gasoline.push(g);group.diesel.push(d);group.sum.push(g+d);
  }
  const out:Record<string,Partial<Record<'gasoline'|'diesel'|'sum',{n:number;mean:number;saving:number;percent:number;below:number}>>>={};
  for(const [key,group] of Object.entries(groups)){
    if(!regions[key])continue;
    out[key]={};
    for(const fuel of ['gasoline','diesel','sum'] as const){
      const values=group[fuel],mean=values.reduce((a,b)=>a+b,0)/values.length;
      const baseline=regions[key][fuel].mean,saving=baseline-mean;
      out[key][fuel]={n:values.length,mean,saving,percent:saving/baseline*100,below:values.filter(v=>v<baseline).length};
    }
  }
  return out;
}
