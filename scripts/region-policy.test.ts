import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basisSido } from '../src/lib/region.ts';
import { DEFAULT_THRESHOLDS, greenRankWith } from '../src/lib/signal.ts';
import { emptyHistory, mergeDay, mergeRegionMean, mergeRegionFuelMean, overDaysOf, overRegionOf, regionMeanOf, sampleDay } from '../src/lib/history.ts';
import { readRaw, listRawDates } from '../src/lib/raw.ts';
import { readFileSync } from 'node:fs';
import type { History } from '../src/lib/history.ts';

test('fuel means use same population and add up to combined means for every stored day', () => {
  const h: History = JSON.parse(readFileSync('client/public/data/history.json', 'utf8'));
  for (const date of h.dates) {
    const i=h.dates.indexOf(date);
    const raw=readRaw<{rows: Parameters<typeof regionMeanOf>[0]}>('data/raw',date)!;
    for (const [fuel, key] of [['gasoline','g'],['diesel','d']] as const) {
      for(const [region, mean] of regionMeanOf(raw.rows,date,fuel)) {
        assert.equal(h.regionFuelMean?.[key]?.[region]?.[i],Math.round(mean*100)/100);
        const g=h.regionFuelMean!.g[region][i]!, d=h.regionFuelMean!.d[region][i]!;
        assert.ok(Math.abs(g+d-h.regionMean![region][i]!)<.011);
      }
    }
  }
});

test('merger boundary selects one pool and fixed ten-rank cutoff', () => {
  for (const [gu, old] of [['광산구', '광주'], ['목포시', '전남']]) {
    assert.equal(basisSido('전남광주', gu, '20260630'), old);
    assert.equal(basisSido('전남광주', gu, '20260701'), '전남광주');
    assert.equal(greenRankWith(old, DEFAULT_THRESHOLDS), 5);
  }
  assert.equal(greenRankWith('전남광주', DEFAULT_THRESHOLDS), 10);
  assert.equal(greenRankWith('전남광주', {...DEFAULT_THRESHOLDS, rankGreenDefault: 3, rankGreenMetro: 20}), 10);
});

test('cancellation follows daily geography across the boundary', () => {
  const h = emptyHistory();
  const rows = [
    {stationId:'A', sido:'전남광주', sigungu:'광산구', gasoline:100, diesel:100},
    {stationId:'B', sido:'전남광주', sigungu:'목포시', gasoline:200, diesel:200},
  ];
  for (const day of ['20260630','20260701']) {
    mergeDay(h, day, sampleDay(rows, new Set(['A','B']), s=>greenRankWith(s, DEFAULT_THRESHOLDS), 2, day));
    mergeRegionMean(h, day, regionMeanOf(rows, day));
    mergeRegionFuelMean(h, day, rows);
  }
  assert.deepEqual(overDaysOf(h,'B','전남광주','20260629','목포시').map(x=>x.over), [0,100]);
  assert.deepEqual(overDaysOf(h,'A','전남광주','20260629','광산구').map(x=>x.mean), [200,300]);
});

test('cancellation is individual fuel OR, counts each day once and includes partial valid days', () => {
  const h: History = {dates:['20260101','20260102','20260103','20260104'],generatedAt:'',
    stations:{A:{g:[120,120,120,null],d:[50,120,null,null],c:[1,1,null,null],s:['g','g',null,null]}},
    regionMean:{서울:[200,200,200,200]},regionFuelMean:{g:{서울:[100,100,100,100]},d:{서울:[100,100,100,100]}}};
  const days=overDaysOf(h,'A','서울','20251231');
  assert.equal(days.length,3);
  assert.equal(days[0].over,-30); // total below mean, gasoline above
  assert.equal(days[0].fuelOver,20);
  assert.equal(overRegionOf(days,'20251231')!.overDays,3);
  assert.equal(overRegionOf(days,'20251231')!.cancel,true);
});

test('all stored daily means agree with independent date-aware raw grouping', () => {
  const h: History = JSON.parse(readFileSync('client/public/data/history.json','utf8'));
  for (const date of listRawDates('data/raw')) {
    const raw = readRaw<{rows: Array<{sido:string;sigungu:string;gasoline:number;diesel:number}>}>('data/raw',date)!;
    const groups = new Map<string,number[]>();
    for (const r of raw.rows) {
      if (!(r.gasoline>0 && r.diesel>0)) continue;
      const old = ['광산구','동구','서구','남구','북구'].includes(r.sigungu)?'광주':'전남';
      const key = r.sido==='전남광주' && date<'20260701'?old:r.sido;
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key)!.push(r.gasoline+r.diesel);
    }
    const i=h.dates.indexOf(date);
    assert.ok(i>=0);
    for (const [key, values] of groups) {
      const mean=Math.round(values.reduce((a,b)=>a+b,0)/values.length*100)/100;
      assert.equal(h.regionMean?.[key]?.[i],mean,`${date} ${key}`);
    }
    const absent=date<'20260701'?['전남광주']:['광주','전남'];
    for (const key of absent) assert.equal(h.regionMean?.[key]?.[i],null,`${date} ${key}`);
  }
});
