/**
 * 차수별 선정 기간·선정 규칙을 보관 원본으로 검증한다.
 *
 *   data/raw/*.json.gz + data/station-rounds.json  →  화면 출력 (파일을 쓰지 않는다)
 *
 * ## 무엇을 확인하나
 *
 * ROUNDS.md 가 공시 일자에서 유추한 차수별 평가기간이 맞는지를, 그 기간의 실제
 * 가격으로 되짚는다. 잣대는 하나다 — **그 차수에 뽑힌 곳들이 그 기간에 유난히
 * 쌌는가.** 기간 가설이 맞으면 자기 기간 칸에서 성적이 뛰고, 틀리면 아무 데서도
 * 뛰지 않는다.
 *
 * 이 방법으로 8차·9차를 먼저 확인했고(각각 7월·8월), 나머지 차수도 같은 모양이
 * 나오는지를 본다 — adjust.ts 의 DEFAULT_ROUND_WINDOWS 참고.
 *
 * ## 왜 남겨 두나
 *
 * 원본 백필이 3월까지 닿는 중이라, 아직 못 채운 달(5월 중순~6월)이 들어오면
 * 5·6·7차를 같은 방법으로 확인해야 한다. 그때 다시 짜지 않도록 둔다.
 *
 * 실행:
 *   npm run rounds:check
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { basisSido } from "../src/lib/region.ts";
import { hasRaw, readRaw } from "../src/lib/raw.ts";
import type { GoodStation } from "../src/lib/types.ts";
import type { EnrichedRow } from "./collect.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const RAW_DIR = path.join(DATA, "raw");

/**
 * 차수별 평가기간 — E컨슈머 공시 일자에서 유추한 것. 근거는 ROUNDS.md.
 *
 * 1~7차는 격주(직전 선정일 다음 날 ~ 그 차수 선정일), 8·9차는 월간이다.
 * 8차가 7월 선정, 9차가 8월 선정이다.
 */
const ROUND_PERIODS: Record<string, [string, string]> = {
  "1차": ["20260318", "20260331"],
  "2차": ["20260401", "20260413"],
  "3차": ["20260414", "20260427"],
  "4차": ["20260428", "20260511"],
  "5차": ["20260512", "20260526"],
  "6차": ["20260527", "20260608"],
  "7차": ["20260609", "20260622"],
  "8차": ["20260701", "20260731"],
  "9차": ["20260801", "20260831"],
};

function eachDay(from: string, to: string): string[] {
  const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}T00:00:00Z`;
  const out: string[] = [];
  const d = new Date(iso(from)), end = new Date(iso(to));
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

interface Avg { sido: string; sigungu: string; sum: number; days: number }

/** 한 기간의 주유소별 일별 합계 평균. 두 유종을 모두 파는 곳만 — 판정 모집단과 같은 잣대다. */
function readPeriod(from: string, to: string) {
  const per = new Map<string, Avg>();
  let files = 0;
  for (const date of eachDay(from, to)) {
    if (!hasRaw(RAW_DIR, date)) continue;
    const raw = readRaw<{ rows: EnrichedRow[] }>(RAW_DIR, date);
    if (!raw) continue;
    files++;
    for (const r of raw.rows) {
      if (r.gasoline == null || r.gasoline <= 0) continue;
      if (r.diesel == null || r.diesel <= 0) continue;
      let a = per.get(r.stationId);
      if (!a) {
        per.set(r.stationId, (a = { sido: basisSido(r.sido, r.sigungu), sigungu: r.sigungu, sum: 0, days: 0 }));
      }
      a.sum += r.gasoline + r.diesel;
      a.days++;
    }
  }
  return { per, files, want: eachDay(from, to).length };
}

/** 묶음별 조밀 순위. 동점이면 같은 등수다 — 선정도 순위가 아니라 값으로 견주기 때문이다. */
function denseRanks(per: Map<string, Avg>, keyOf: (a: Avg) => string) {
  const groups = new Map<string, Array<[string, number]>>();
  for (const [id, a] of per) {
    const k = keyOf(a);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push([id, a.sum / a.days]);
  }
  const out = new Map<string, { rank: number; n: number }>();
  for (const [, arr] of groups) {
    arr.sort((p, q) => p[1] - q[1]);
    let rank = 0, prev = NaN;
    for (const [id, v] of arr) {
      if (v !== prev) { rank++; prev = v; }
      out.set(id, { rank, n: arr.length });
    }
  }
  return out;
}

const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : NaN);

function main() {
  const good: GoodStation[] = JSON.parse(readFileSync(path.join(DATA, "good-stations.json"), "utf8"));
  const src = JSON.parse(readFileSync(path.join(DATA, "station-rounds.json"), "utf8")) as {
    stations: Record<string, { first: string; last: string; rounds: string[] }>;
  };

  /**
   * 차수 → 그 차수에 뽑힌 적 있는 주유소.
   *
   * 기준선(build-baseline)은 **마지막** 차수를 쓰지만 여기서는 다르다. 묻는 것이
   * 그 차수 선정 때 이 곳이 쌌느냐라서, 다시 뽑힌 곳은 두 차수 모두에 세야 한다.
   */
  const members = new Map<string, Set<string>>();
  for (const g of good) {
    if (!g.stationId) continue;
    for (const r of src.stations[g.stationId]?.rounds ?? (g.round ? [g.round] : [])) {
      (members.get(r) ?? members.set(r, new Set()).get(r)!).add(g.stationId);
    }
  }

  const loaded = new Map<string, ReturnType<typeof readPeriod>>();
  for (const [round, [from, to]] of Object.entries(ROUND_PERIODS)) {
    const w = readPeriod(from, to);
    const mark = w.files === w.want ? "" : w.files === 0 ? "  ← 원본 없음" : "  ← 원본 모자람";
    console.log(`[기간] ${round} ${from}~${to}  ${w.files}/${w.want}일 · 주유소 ${w.per.size}${mark}`);
    if (w.files > 0) loaded.set(round, w);
  }

  // ── 교차표: 어느 기간에서 성적이 뛰는가 ─────────────────────────────
  const cols = [...loaded.keys()];
  const greenRank = (sido: string) => (sido === "서울" || sido === "경기" ? 10 : 5);
  console.log("\n■ 차수 × 기간 — 그 기간에 시·도 상위 N위(서울·경기 10, 그 외 5) 안에 든 비율");
  console.log("  차수(곳)  " + cols.map((c) => c.padStart(7)).join(""));
  for (const round of Object.keys(ROUND_PERIODS)) {
    const ids = members.get(round);
    if (!ids?.size) continue;
    const cells = cols.map((c) => {
      const { per } = loaded.get(c)!;
      const rank = denseRanks(per, (a) => a.sido);
      let hit = 0, tot = 0;
      for (const id of ids) {
        const r = rank.get(id);
        if (!r) continue;
        tot++;
        if (r.rank <= greenRank(per.get(id)!.sido)) hit++;
      }
      return (tot ? `${Math.round((hit * 100) / tot)}%` : "—").padStart(7);
    });
    console.log(`  ${round}(${String(ids.size).padStart(3)})  ` + cells.join(""));
  }

  // ── 자기 기간에서 본 선정 규칙 ──────────────────────────────────────
  console.log("\n■ 자기 기간에서 본 선정 규칙");
  console.log("  차수   시·도 순위 중앙   시·군·구 순위 중앙   시·도 평균 이하   시·도 상위 10%");
  for (const round of Object.keys(ROUND_PERIODS)) {
    const w = loaded.get(round);
    const ids = members.get(round);
    if (!w || !ids?.size) continue;
    const bySido = denseRanks(w.per, (a) => a.sido);
    const bySgg = denseRanks(w.per, (a) => `${a.sido}|${a.sigungu}`);
    const mean = new Map<string, { s: number; n: number }>();
    for (const [, a] of w.per) {
      const m = mean.get(a.sido) ?? mean.set(a.sido, { s: 0, n: 0 }).get(a.sido)!;
      m.s += a.sum / a.days;
      m.n++;
    }
    const have = [...ids].filter((id) => w.per.has(id));
    if (!have.length) continue;
    let below = 0, top10 = 0;
    for (const id of have) {
      const a = w.per.get(id)!, m = mean.get(a.sido)!, r = bySido.get(id)!;
      if (a.sum / a.days <= m.s / m.n) below++;
      if (r.rank <= r.n * 0.1) top10++;
    }
    const pct = (k: number) => `${Math.round((k * 100) / have.length)}%`;
    console.log(
      `  ${round}  ${String(median(have.map((i) => bySido.get(i)!.rank))).padStart(12)}위` +
      `${String(median(have.map((i) => bySgg.get(i)!.rank))).padStart(17)}위` +
      `${pct(below).padStart(16)}${pct(top10).padStart(15)}`,
    );
  }

  // ── 시·도별 선정 수 ─────────────────────────────────────────────────
  //
  // 명단은 09-01 기준이라 그 뒤 빠진 곳만큼 적게 세어진다. 최근 차수일수록
  // 실제 배정에 가깝다.
  console.log("\n■ 시·도별 선정 수");
  const sidos = new Set<string>();
  const table = new Map<string, Map<string, number>>();
  for (const round of Object.keys(ROUND_PERIODS)) {
    const w = loaded.get(round), ids = members.get(round);
    if (!w || !ids) continue;
    const row = new Map<string, number>();
    for (const id of ids) {
      const a = w.per.get(id);
      if (!a) continue;
      sidos.add(a.sido);
      row.set(a.sido, (row.get(a.sido) ?? 0) + 1);
    }
    table.set(round, row);
  }
  const order = [...sidos].sort();
  console.log("  차수  " + order.map((s) => s.padStart(5)).join(""));
  for (const [round, row] of table) {
    console.log(`  ${round}  ` + order.map((s) => String(row.get(s) ?? 0).padStart(5)).join(""));
  }
}

main();
