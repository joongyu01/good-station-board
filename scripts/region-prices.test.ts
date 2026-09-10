import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distribution, buildRegionPrices, type RegionPriceHistory } from '../src/lib/region-prices.ts';
import type { History } from '../src/lib/history.ts';

test('population deviation and interpolated quartiles',()=>{
  assert.deepEqual(distribution([100,200,300,400]),{n:4,mean:250,median:250,min:100,max:400,sd:111.8,q1:175,q3:325,cv:44.72});
  assert.equal(distribution([10]).sd,0);
});
test('daily merger and common dual-fuel population',()=>{
  const rows=[{sido:'전남광주',sigungu:'광산구',gasoline:100,diesel:200},{sido:'전남광주',sigungu:'목포시',gasoline:300,diesel:400},{sido:'전남광주',sigungu:'목포시',gasoline:500,diesel:null}];
  assert.equal(Object.keys(buildRegionPrices(rows,'20260630')).length,2);
  const r=buildRegionPrices(rows,'20260701')['전남광주'];
  assert.equal(r.gasoline.n,2);assert.equal(r.gasoline.mean,200);assert.equal(r.diesel.mean,300);assert.equal(r.sum.mean,500);
});
test('all published daily means match cancellation history and statistics bounds',()=>{
  const stats:RegionPriceHistory=JSON.parse(readFileSync('client/public/data/region-prices.json','utf8'));
  const history:History=JSON.parse(readFileSync('client/public/data/history.json','utf8'));
  assert.deepEqual(Object.keys(stats.days),history.dates);
  for(const [date,regions] of Object.entries(stats.days)){
    const i=history.dates.indexOf(date);
    for(const [region,r] of Object.entries(regions)){
      assert.ok(Math.abs(r.gasoline.mean-history.regionFuelMean!.g[region][i]!)<.011);
      assert.ok(Math.abs(r.diesel.mean-history.regionFuelMean!.d[region][i]!)<.011);
      assert.ok(Math.abs(r.sum.mean-history.regionMean![region][i]!)<.011);
      for(const s of Object.values(r)){assert.ok(s.min<=s.q1&&s.q1<=s.median&&s.median<=s.q3&&s.q3<=s.max);assert.ok(s.sd>=0);}
    }
  }
});
