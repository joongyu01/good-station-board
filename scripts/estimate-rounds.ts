/**
 * 차수별 평가기간을 원본에서 **추산**한다.
 *
 *   data/raw/*.json.gz + data/station-rounds.json  →  화면 출력 (파일을 쓰지 않는다)
 *
 * ## check-rounds 와 무엇이 다른가
 *
 * check-rounds 는 ROUNDS.md 가 공시 일자에서 유추한 기간이 맞는지를 **확인**한다.
 * 이쪽은 그 가설을 쓰지 않는다. 보관 원본 190일 전 구간에 길이 7~40일 창을
 * 모두 밀어 보고, 그 차수에 뽑힌 곳들이 가장 잘 설명되는 구간을 찾는다.
 *
 * ## 두 가지로 잰다
 *
 *   창 탐색   창의 일별 평균가로 시·도 순위를 매겨 상위 N위 충족률을 본다.
 *             선정이 실제로 하는 계산과 같은 모양이다. 다만 짧은 창일수록
 *             높게 나오므로(하루만 싸면 되니까) 길이별로 나눠 본다.
 *
 *   일별 곡선 하루씩 따로 충족률을 내어 언제 오르고 언제 꺼지는지 본다.
 *             창 탐색이 못 잡는 **경계**가 여기서 보인다. 최고점의 80% 를
 *             넘는 연속 구간을 그 차수가 값을 유지한 구간으로 읽는다.
 *
 * 두 잣대가 같은 구간을 가리키고 그것이 공시 일자와 맞으면 기간이 확인된 것이다.
 *
 * 실행:
 *   npm run rounds:estimate
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { basisSido } from "../src/lib/region.ts";
import { readRaw } from "../src/lib/raw.ts";
import type { GoodStation } from "../src/lib/types.ts";
import type { EnrichedRow } from "./collect.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const RAW_DIR = path.join(DATA, "raw");

/** 창 길이 탐색 범위. 격주(13~15일)와 월간(28~31일)을 모두 담는다. */
const MIN_LEN = 7;
const MAX_LEN = 40;

/** 창 안에서 이만큼은 가격이 있어야 순위에 넣는다. 며칠 걸러도 평균이 서게. */
const MIN_COVER = 0.6;

/** E컨슈머 공시 선정일. 추산 결과를 견주는 데만 쓴다 — 탐색에는 넣지 않는다. */
const ANNOUNCED: Record<string, string> = {
  "1차": "20260331", "2차": "20260413", "3차": "20260427", "4차": "20260511",
  "5차": "20260526", "6차": "20260608", "7차": "20260622", "8차": "20260804", "9차": "20260903",
};

/** ROUNDS.md 가 유추한 기간. 추산값과 견주는 데만 쓴다. */
const GUESS: Record<string, [string, string]> = {
  "1차": ["20260318", "20260331"], "2차": ["20260401", "20260413"], "3차": ["20260414", "20260427"],
  "4차": ["20260428", "20260511"], "5차": ["20260512", "20260526"], "6차": ["20260527", "20260608"],
  "7차": ["20260609", "20260622"], "8차": ["20260701", "20260731"], "9차": ["20260801", "20260831"],
};

const fmt = (d: string) => `${d.slice(4, 6)}-${d.slice(6)}`;

function main() {
  // ── 원본을 통째로 올린다 ────────────────────────────────────────────
  const dates = readdirSync(RAW_DIR)
    .map((f) => f.replace(/\.json(\.gz)?$/, ""))
    .filter((s) => /^\d{8}$/.test(s))
    .sort()
    .filter((v, i, a) => a[i - 1] !== v);
  const D = dates.length;

  const index = new Map<string, number>();
  const sidoOf: string[] = [];
  /** 주유소 × 날짜 합계. 없는 날은 0 이고 cnt 로 가른다. */
  const sums: Float64Array[] = [];
  const cnts: Int32Array[] = [];

  for (let d = 0; d < D; d++) {
    const raw = readRaw<{ rows: EnrichedRow[] }>(RAW_DIR, dates[d]);
    if (!raw) continue;
    for (const r of raw.rows) {
      if (r.gasoline == null || r.gasoline <= 0) continue;
      if (r.diesel == null || r.diesel <= 0) continue;
      let i = index.get(r.stationId);
      if (i === undefined) {
        i = sidoOf.length;
        index.set(r.stationId, i);
        sidoOf.push(basisSido(r.sido, r.sigungu));
        sums.push(new Float64Array(D));
        cnts.push(new Int32Array(D));
      }
      sums[i][d] = r.gasoline + r.diesel;
      cnts[i][d] = 1;
    }
  }
  const S = sidoOf.length;
  console.log(`원본 ${D}일 (${fmt(dates[0])} ~ ${fmt(dates[D - 1])}) · 주유소 ${S}곳`);

  // 창 합계를 O(1) 로 내려고 누적합을 미리 만든다.
  const psum: Float64Array[] = [], pcnt: Int32Array[] = [];
  for (let i = 0; i < S; i++) {
    const ps = new Float64Array(D + 1), pc = new Int32Array(D + 1);
    for (let d = 0; d < D; d++) { ps[d + 1] = ps[d] + sums[i][d]; pc[d + 1] = pc[d] + cnts[i][d]; }
    psum.push(ps); pcnt.push(pc);
  }

  // 시·도 목록과 초록 기준 순위
  const sidos = [...new Set(sidoOf)];
  const sidoIdx = new Map(sidos.map((s, i) => [s, i]));
  const sidoNo = sidoOf.map((s) => sidoIdx.get(s)!);
  const greenRank = sidos.map((s) => (s === "서울" || s === "경기" ? 10 : 5));

  // ── 차수별 명단 ─────────────────────────────────────────────────────
  const good: GoodStation[] = JSON.parse(readFileSync(path.join(DATA, "good-stations.json"), "utf8"));
  const src = JSON.parse(readFileSync(path.join(DATA, "station-rounds.json"), "utf8")) as {
    stations: Record<string, { first: string; last: string; rounds: string[] }>;
  };
  const rounds = Object.keys(GUESS);
  const members = new Map<string, number[]>(rounds.map((r) => [r, []]));
  /**
   * 그 차수에**만** 뽑힌 곳.
   *
   * 절반 넘는 곳이 여러 차수에 걸쳐 다시 뽑힌다. 그런 곳은 이웃 차수 곡선에도
   * 함께 실려 경계를 뭉갠다. 단독 차수만 남기면 표본은 줄어도 구간이 또렷해진다.
   */
  const solo = new Map<string, number[]>(rounds.map((r) => [r, []]));
  for (const g of good) {
    if (!g.stationId) continue;
    const i = index.get(g.stationId);
    if (i === undefined) continue;
    const rs = src.stations[g.stationId]?.rounds ?? (g.round ? [g.round] : []);
    for (const r of rs) {
      members.get(r)?.push(i);
      if (rs.length === 1) solo.get(r)?.push(i);
    }
  }

  /**
   * 창 [a,b] 의 시·도별 커트라인(N번째로 싼 서로 다른 값)과 주유소별 평균.
   *
   * 전부 정렬하지 않는다. N 이 10 이하라 각 시·도마다 가장 싼 값 N 개만 들고
   * 있으면 된다 — 만 곳을 창마다 정렬하면 탐색이 몇 분씩 걸린다.
   */
  const mean = new Float64Array(S);
  function cutoffs(a: number, b: number): Float64Array {
    const need = Math.ceil((b - a + 1) * MIN_COVER);
    const best: number[][] = sidos.map(() => []);
    for (let i = 0; i < S; i++) {
      const n = pcnt[i][b + 1] - pcnt[i][a];
      if (n < need) { mean[i] = NaN; continue; }
      const v = (psum[i][b + 1] - psum[i][a]) / n;
      mean[i] = v;
      const s = sidoNo[i], arr = best[s], k = greenRank[s];
      if (arr.length === k && v >= arr[k - 1]) continue;
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
      if (arr[lo] === v) continue;              // 같은 값은 같은 등수다
      arr.splice(lo, 0, v);
      if (arr.length > k) arr.pop();
    }
    const out = new Float64Array(sidos.length);
    for (let s = 0; s < sidos.length; s++) out[s] = best[s].length ? best[s][best[s].length - 1] : NaN;
    return out;
  }

  /** 그 창에서 상위 N위 안에 든 비율. */
  function share(ids: number[], cut: Float64Array): number {
    let hit = 0, tot = 0;
    for (const i of ids) {
      if (Number.isNaN(mean[i])) continue;
      tot++;
      const c = cut[sidoNo[i]];
      if (!Number.isNaN(c) && mean[i] <= c) hit++;
    }
    return tot ? hit / tot : 0;
  }

  // ── 창 탐색 ─────────────────────────────────────────────────────────
  //
  // 창마다 커트라인을 한 번만 내고 아홉 차수를 함께 채점한다. 차수별로 따로
  // 돌면 같은 계산을 아홉 번 한다.
  type Best = { score: number; a: number; b: number };
  const bestAny = new Map<string, Best>(rounds.map((r) => [r, { score: -1, a: 0, b: 0 }]));
  const bestSolo = new Map<string, Best>(rounds.map((r) => [r, { score: -1, a: 0, b: 0 }]));
  /** 길이별 최고. 짧은 창이 유리한 편향을 보려고 나눠 둔다. */
  const bestByLen = new Map<string, Map<number, Best>>(rounds.map((r) => [r, new Map()]));

  for (let len = MIN_LEN; len <= MAX_LEN; len++) {
    for (let a = 0; a + len - 1 < D; a++) {
      const b = a + len - 1;
      const cut = cutoffs(a, b);
      for (const r of rounds) {
        const sc = share(members.get(r)!, cut);
        const any = bestAny.get(r)!;
        if (sc > any.score) { any.score = sc; any.a = a; any.b = b; }
        const byLen = bestByLen.get(r)!;
        const cur = byLen.get(len);
        if (!cur || sc > cur.score) byLen.set(len, { score: sc, a, b });
        const so = bestSolo.get(r)!, ss = share(solo.get(r)!, cut);
        if (ss > so.score) { so.score = ss; so.a = a; so.b = b; }
      }
    }
  }

  // ── 일별 곡선 ───────────────────────────────────────────────────────
  const daily = new Map<string, number[]>(rounds.map((r) => [r, []]));
  for (let d = 0; d < D; d++) {
    const cut = cutoffs(d, d);
    for (const r of rounds) daily.get(r)!.push(share(members.get(r)!, cut));
  }

  /** 최고점의 80% 를 넘는 가장 긴 연속 구간. 값을 유지한 구간으로 읽는다. */
  function plateau(v: number[]): [number, number, number] {
    const peak = Math.max(...v), thr = peak * 0.8;
    let bs = 0, be = -1, cs = -1;
    for (let d = 0; d <= v.length; d++) {
      if (d < v.length && v[d] >= thr) { if (cs < 0) cs = d; continue; }
      if (cs >= 0 && d - 1 - cs > be - bs) { bs = cs; be = d - 1; }
      cs = -1;
    }
    return [bs, be, peak];
  }

  // ── 출력 ────────────────────────────────────────────────────────────
  const pc = (v: number) => `${Math.round(v * 100)}%`;
  console.log("\n■ 차수별 기간 추산");
  console.log("  차수  공시 선정일   ROUNDS.md 가설 (점수)      일별 곡선 고원 (최고점)      창 탐색 최고 (길이·점수)");
  for (const r of rounds) {
    const [gs, ge] = GUESS[r];
    const gi = dates.indexOf(gs), gj = dates.indexOf(ge);
    const gScore = gi >= 0 && gj >= 0 ? pc(share(members.get(r)!, cutoffs(gi, gj))) : "—";
    const [ps, pe, peak] = plateau(daily.get(r)!);
    const bt = bestAny.get(r)!;
    console.log(
      `  ${r}  ${fmt(ANNOUNCED[r])}      ` +
      `${fmt(gs)}~${fmt(ge)} (${gScore.padStart(4)})      ` +
      `${fmt(dates[ps])}~${fmt(dates[pe])} (${pc(peak).padStart(4)})      ` +
      `${fmt(dates[bt.a])}~${fmt(dates[bt.b])} (${String(bt.b - bt.a + 1).padStart(2)}일 ${pc(bt.score).padStart(4)})`,
    );
  }

  console.log("\n■ 길이별 최고 창 — 짧은 창이 유리하므로 길이를 고정해 견준다");
  const lens = [7, 14, 21, 28, 35];
  console.log("  차수  " + lens.map((l) => `${l}일`.padStart(18)).join(""));
  for (const r of rounds) {
    const byLen = bestByLen.get(r)!;
    console.log(`  ${r}  ` + lens.map((l) => {
      const x = byLen.get(l)!;
      return `${fmt(dates[x.a])}~${fmt(dates[x.b])} ${pc(x.score)}`.padStart(18);
    }).join(""));
  }

  console.log("\n■ 그 차수에만 뽑힌 곳으로 다시 추산 — 이웃 차수에 겹친 곳을 뺀다");
  console.log("  차수  단독  창 탐색 최고 (길이·점수)");
  for (const r of rounds) {
    const n = solo.get(r)!.length;
    const b = bestSolo.get(r)!;
    console.log(
      `  ${r}  ${String(n).padStart(3)}곳  ` +
      (n ? `${fmt(dates[b.a])}~${fmt(dates[b.b])} (${String(b.b - b.a + 1).padStart(2)}일 ${pc(b.score).padStart(4)})` : "—"),
    );
  }

  // ── 마감 시차 ───────────────────────────────────────────────────────
  //
  // 격주 차수의 추산 구간이 공시일보다 며칠씩 이르게 나온다. 평가를 마감하고
  // 공시하기까지 걸린 날이 있다는 뜻이다. 그 시차 k 를 직접 찾는다.
  //
  //   평가기간(k) = [직전 공시일 − k + 1일,  그 차수 공시일 − k]
  //
  // k=0 이 ROUNDS.md 의 가설이다.
  console.log("\n■ 마감 시차 — 평가기간을 공시일보다 k일 앞당겨 잡으면");
  const chain = ["2차", "3차", "4차", "5차", "6차", "7차"];
  const at = (d: string) => dates.indexOf(d);
  console.log("   k  " + chain.map((r) => r.padStart(6)).join("") + "    4~7차 평균");
  let bestK = { k: 0, avg: -1 };
  for (let k = 0; k <= 12; k++) {
    const cells: string[] = [];
    let sum = 0, n = 0;
    for (const r of chain) {
      const prev = rounds[rounds.indexOf(r) - 1];
      const a = at(ANNOUNCED[prev]) - k + 1, b = at(ANNOUNCED[r]) - k;
      if (a < 0 || b >= D || a > b) { cells.push("—".padStart(6)); continue; }
      const sc = share(members.get(r)!, cutoffs(a, b));
      cells.push(pc(sc).padStart(6));
      if (r >= "4차" && r <= "7차") { sum += sc; n++; }
    }
    const avg = n ? sum / n : 0;
    if (avg > bestK.avg) bestK = { k, avg };
    console.log(`  ${String(k).padStart(2)}  ` + cells.join("") + `    ${pc(avg).padStart(4)}`);
  }
  console.log(`  → 4~7차 평균이 가장 높은 시차는 k=${bestK.k}일 (${pc(bestK.avg)})`);
  for (const r of chain) {
    const prev = rounds[rounds.indexOf(r) - 1];
    const a = at(ANNOUNCED[prev]) - bestK.k + 1, b = at(ANNOUNCED[r]) - bestK.k;
    if (a < 0 || b >= D || a > b) continue;
    console.log(`     ${r} ${fmt(dates[a])}~${fmt(dates[b])} (${b - a + 1}일)`);
  }

  console.log("\n■ 일별 충족률 곡선 (□ 0% · ▁▂▃▄▅▆▇█ 최고점 대비)");
  const bars = "▁▂▃▄▅▆▇█";
  for (const r of rounds) {
    const v = daily.get(r)!, peak = Math.max(...v);
    const line = v.map((x) => (x === 0 ? "□" : bars[Math.min(7, Math.floor((x / peak) * 8 - 1e-9))])).join("");
    console.log(`  ${r} ${line}`);
  }
  const ticks = dates.map((d, i) => (d.endsWith("01") ? fmt(d).slice(0, 2) : null));
  let axis = "";
  for (let i = 0; i < D; i++) axis += ticks[i] ? `${ticks[i]}` : (i > 0 && ticks[i - 1] ? "" : "·");
  console.log(`       ${axis}`);
}

main();
