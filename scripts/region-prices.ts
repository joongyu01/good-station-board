import path from 'node:path';
import { listRawDates, readRaw } from '../src/lib/raw.ts';
import { buildRegionPrices, type RegionPriceHistory } from '../src/lib/region-prices.ts';
import { writeJsonIfChanged } from '../src/lib/stable-write.ts';

/** 원본에서 매번 재계산하여 과거 정정도 반영한다. 브라우저에는 요약만 전달한다. */
export function writeRegionPrices(rawDir:string,outDir:string,through:string){
  const data:RegionPriceHistory={version:1,days:{}};
  for(const date of listRawDates(rawDir).filter(d=>d<=through)){
    const raw=readRaw<{rows:Parameters<typeof buildRegionPrices>[0]}>(rawDir,date);
    if(raw)data.days[date]=buildRegionPrices(raw.rows,date);
  }
  writeJsonIfChanged(path.join(outDir,'region-prices.json'),data);
  console.log(`[region-prices] ${Object.keys(data.days).length}일 단위지역 가격 분포`);
}
