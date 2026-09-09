import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { emptyHistory, mergeDay, mergeRegionMean, type DaySample } from "../src/lib/history.ts";
import { applyJudging, baseAt, cutoffsOf, type Judging } from "../src/lib/judge.ts";
import { basisSido } from "../src/lib/region.ts";
import { VIEW_MODES, type BoardData } from "../src/lib/types.ts";
import { applyJudgeMode } from "../client/src/lib/board.ts";
import { readRaw } from "../src/lib/raw.ts";
import { distinctAsc, coefficientOf } from "../src/lib/signal.ts";

const sample = new Map<string, DaySample>([["A", {
  gasoline: 100, diesel: 100, coefficient: 1, signal: "g",
}]]);

test("out-of-order dates preserve aligned prices and regional means", () => {
  const h = emptyHistory();
  for (const [d, mean] of [["20260901", 200], ["20260903", 300], ["20260902", 250]] as const) {
    mergeDay(h, d, sample);
    mergeRegionMean(h, d, new Map([["region", mean]]));
  }
  assert.deepEqual(h.dates, ["20260901", "20260902", "20260903"]);
  assert.deepEqual(h.regionMean?.region, [200, 250, 300]);
  mergeDay(h, "20260831", sample);
  mergeRegionMean(h, "20260831", new Map([["region", 150]]));
  assert.deepEqual(h.regionMean?.region, [150, 200, 250, 300]);
});

test("same-day replacement clears absent stations and regions only on that day", () => {
  const h = emptyHistory();
  for (const d of ["20260901", "20260902"]) {
    mergeDay(h, d, sample);
    mergeRegionMean(h, d, new Map([["region", 200]]));
  }
  mergeDay(h, "20260902", new Map());
  mergeRegionMean(h, "20260902", new Map());
  for (const key of ["g", "d", "c", "s"] as const) {
    assert.equal(h.stations.A[key][1], null);
    assert.notEqual(h.stations.A[key][0], null);
  }
  assert.deepEqual(h.regionMean?.region, [200, null]);
});

const judging: Judging = {
  rankGreenMetro: 10, rankGreenDefault: 5, rankYellowFactor: 2,
  judgeMode: "adjusted", adjustedCombine: "both", driftGreen: 0, driftYellow: .01,
};
const board: BoardData = JSON.parse(readFileSync("client/public/data/latest.json", "utf8"));

test("cancellation without an adjusted baseline survives every judging method", () => {
  const b = structuredClone(board);
  const s = b.stations.find(s => s.overRegion?.cancel)!;
  assert.ok(s);
  s.adjusted = null;
  b.stations = [s];
  const offline = applyJudgeMode({ ...b, judgeMode: "adjusted" });
  assert.equal(offline.stations[0].signal, "unknown");
  assert.equal(offline.summary.counts.cancel, 1);
  for (const judgeMode of ["rank", "adjusted"] as const) {
    for (const adjustedCombine of ["rank", "drift", "both"] as const) {
      const result = applyJudging(b, { ...judging, judgeMode, adjustedCombine });
      assert.notEqual(result.stations[0].signal, "cancel");
      assert.equal(result.summary.counts.cancel, 1);
      assert.equal(result.summary.adjustedCounts?.cancel, 1);
    }
  }
});

test("regenerated board denominators match national raw for every allowed green rank", () => {
  assert.equal(board.cutoffsComplete, true);
  const raw = readRaw<{ rows: Array<{ sido: string; sigungu: string; gasoline: number | null; diesel: number | null }> }>("data/raw", board.date)!;
  const distributions = new Map<string, number[]>();
  for (const row of raw.rows) {
    const region = basisSido(row.sido, row.sigungu);
    for (const mode of VIEW_MODES) {
      const g = row.gasoline != null && row.gasoline > 0 ? row.gasoline : null;
      const d = row.diesel != null && row.diesel > 0 ? row.diesel : null;
      const value = mode === "gasoline" ? g : mode === "diesel" ? d : g != null && d != null ? g + d : null;
      if (value == null) continue;
      const key = `${region}|${mode}`;
      if (!distributions.has(key)) distributions.set(key, []);
      distributions.get(key)!.push(value);
    }
  }
  for (const [key, values] of distributions) {
    const [region, mode] = key.split("|");
    const distinct = distinctAsc(values.sort((a, b) => a - b));
    const cut = board.cutoffs?.[region]?.[mode as typeof VIEW_MODES[number]];
    assert.deepEqual(cut, distinct);
    for (let rank = 1; rank <= 500; rank++) {
      assert.equal(baseAt(cut, rank, true), distinct[Math.min(rank, distinct.length) - 1]);
    }
  }
  const updated = applyJudging(board, { ...judging, judgeMode: "rank", rankGreenMetro: 50, rankGreenDefault: 50 });
  for (const s of updated.stations) {
    for (const mode of VIEW_MODES) {
      const m = s.metrics[mode];
      assert.equal(m.coefficient, coefficientOf(m.price, m.greenBase)?.coefficient ?? null);
      if (m.signal === "green" && m.coefficient != null) assert.ok(m.coefficient <= 1);
    }
  }
});

test("full distributions support rank 500 and last-price clamping", () => {
  const prices = Array.from({ length: 600 }, (_, i) => 3000 + i);
  assert.equal(baseAt(cutoffsOf(prices), 500, true), 3499);
  assert.equal(baseAt([100, 200], 500, true), 200);
  assert.equal(baseAt(prices.slice(0, 40), 50), null);
});

test("legacy truncated distributions never reuse an unrelated denominator", () => {
  const b = structuredClone(board);
  b.cutoffsComplete = false;
  for (const region of Object.values(b.cutoffs ?? {})) {
    for (const mode of VIEW_MODES) region[mode] = region[mode]?.slice(0, 40);
  }
  const result = applyJudging(b, { ...judging, judgeMode: "rank", rankGreenMetro: 50, rankGreenDefault: 50 });
  for (const s of result.stations) {
    const cut = b.cutoffs?.[basisSido(s.sido, s.sigungu)]?.sum;
    if (cut?.length === 40 && s.greenRank === 50) assert.equal(s.metrics.sum.coefficient, null);
  }
});
