import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareGoodPrices } from '../src/lib/good-price-comparison.ts';
import { buildRegionPrices,compareRegionOrder } from '../src/lib/region-prices.ts';
import type { History } from '../src/lib/history.ts';
import type { StationSignal } from '../src/lib/types.ts';

test('same-date comparison excludes pre-selection, missing and duplicate stations',()=>{
  const stations=[{stationId:'A',sido:'서울',sigungu:'중구',rounds:['1차']},
    {stationId:'A',sido:'서울',sigungu:'중구',rounds:['1차']},
    {stationId:'B',sido:'서울',sigungu:'중구',rounds:['9차']},
    {stationId:'C',sido:'서울',sigungu:'중구',rounds:['1차']}] as StationSignal[];
  const history={dates:['20260331','20260401'],stations:{A:{g:[100,100],d:[200,200]},B:{g:[50,50],d:[50,50]},C:{g:[100,100],d:[null,null]}}} as History;
  const regions=buildRegionPrices([{sido:'서울',sigungu:'중구',gasoline:200,diesel:300}],'20260401');
  assert.deepEqual(compareGoodPrices(stations,history,'20260331',regions),{});
  const result=compareGoodPrices(stations,history,'20260401',regions)['서울'];
  assert.deepEqual(result.gasoline,{n:1,mean:100,saving:100,percent:50,below:1});
  assert.equal(result.sum!.saving,200);
  const expensive=buildRegionPrices([{sido:'서울',sigungu:'중구',gasoline:50,diesel:100}],'20260401');
  assert.equal(compareGoodPrices(stations,history,'20260401',expensive)['서울'].gasoline!.saving,-50);
});
test('regional display begins Seoul Gyeonggi Incheon',()=>{
  assert.deepEqual(['강원','서울','인천','경기','부산'].sort(compareRegionOrder),['서울','경기','인천','부산','강원']);
});
