import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basisSido } from '../src/lib/region.ts';
import { DEFAULT_THRESHOLDS, greenRankWith } from '../src/lib/signal.ts';
import { emptyHistory, mergeDay, mergeRegionMean, overDaysOf, regionMeanOf, sampleDay } from '../src/lib/history.ts';
import { readRaw, listRawDates } from '../src/lib/raw.ts';
import { readFileSync } from 'node:fs';
import type { History } from '../src/lib/history.ts';

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
  }
  assert.deepEqual(overDaysOf(h,'B','전남광주','20260629','목포시').map(x=>x.over), [0,100]);
  assert.deepEqual(overDaysOf(h,'A','전남광주','20260629','광산구').map(x=>x.mean), [200,300]);
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
