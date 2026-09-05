/**
 * 과거 시계열 채우기 — 오피넷 기간 조회
 *
 *   Opinet opDownload.do (START_DT~END_DT)  →  data/history.json
 *
 * 오피넷 다운로드 폼은 기간 조회를 지원한다. 다만 길게 잡으면 응답이 오지
 * 않는다 — 7일치는 10분을 기다려도 파일이 떨어지지 않았고 3일치(30,714행,
 * 4MB)는 정상이었다. 그래서 기본 3일씩 끊어 받는다.
 *
 * 받은 원본은 버린다. 남기는 것은 착한주유소의 휘발유·경유·계수 세 값뿐이라
 * 두 달치를 합쳐도 500KB 남짓이다. 전국 원본을 날짜별로 쌓으면 하루 4MB씩
 * 불어나 저장소가 버티지 못한다.
 *
 * 이미 받은 날짜는 건너뛴다. 중간에 끊겨도 다시 실행하면 이어서 채운다.
 *
 * 실행:
 *   npm run backfill                       2026-07-01 ~ 어제
 *   npm run backfill 20260701 20260903     기간 지정
 *   npm run backfill --chunk=2             한 번에 받을 일수
 *   npm run backfill --force               이미 받은 날짜도 다시 받는다
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadOilPrice } from "../src/lib/opinet/scraper.ts";
import { parseOilPriceFile } from "../src/lib/opinet/parser.ts";
import { normalizeRegion } from "../src/lib/region.ts";
import { greenRankWith, DEFAULT_THRESHOLDS, type Thresholds } from "../src/lib/signal.ts";
import { emptyHistory, mergeDay, pruneTo, sampleDay, type History } from "../src/lib/history.ts";
import type { GoodStation } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const HISTORY = path.join(DATA, "history.json");

/** 시계열 시작일. 요구사항이 7월 1일부터다. */
const DEFAULT_FROM = "20260701";

/** 한 번에 받을 일수. 3일이 확인된 상한이다. */
const DEFAULT_CHUNK = 3;

function yesterdayKST(): string {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function toDate(yyyymmdd: string): Date {
  return new Date(Date.UTC(
    Number(yyyymmdd.slice(0, 4)),
    Number(yyyymmdd.slice(4, 6)) - 1,
    Number(yyyymmdd.slice(6, 8)),
  ));
}

function toStr(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function addDays(yyyymmdd: string, n: number): string {
  const d = toDate(yyyymmdd);
  d.setUTCDate(d.getUTCDate() + n);
  return toStr(d);
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dates = args.filter((a) => /^\d{8}$/.test(a));
  const from = dates[0] ?? DEFAULT_FROM;
  const to = dates[1] ?? yesterdayKST();
  const chunk = Number(args.find((a) => a.startsWith("--chunk="))?.slice(8) ?? DEFAULT_CHUNK);
  const force = args.includes("--force");

  const goodPath = path.join(DATA, "good-stations.json");
  if (!existsSync(goodPath)) {
    console.error("data/good-stations.json 이 없습니다. 먼저 `npm run normalize`.");
    process.exit(1);
  }
  const good: GoodStation[] = JSON.parse(readFileSync(goodPath, "utf8"));

  const mappingPath = path.join(DATA, "station-mapping.json");
  const mapping: Record<string, { stationId: string }> = existsSync(mappingPath)
    ? JSON.parse(readFileSync(mappingPath, "utf8")) : {};

  const ids = new Set<string>();
  for (const g of good) {
    const id = g.stationId ?? mapping[String(g.seq)]?.stationId;
    if (id) ids.add(id);
  }

  const thPath = path.join(DATA, "thresholds.json");
  const th: Thresholds = existsSync(thPath)
    ? { ...DEFAULT_THRESHOLDS, ...JSON.parse(readFileSync(thPath, "utf8")) }
    : DEFAULT_THRESHOLDS;

  const history: History = existsSync(HISTORY)
    ? JSON.parse(readFileSync(HISTORY, "utf8")) : emptyHistory();

  const have = new Set(history.dates);
  const wanted = eachDay(from, to);
  const missing = force ? wanted : wanted.filter((d) => !have.has(d));

  console.log(`[backfill] 기간 ${from}~${to} (${wanted.length}일)`);
  console.log(`[backfill] 이미 보유 ${wanted.length - missing.length}일 / 받을 ${missing.length}일`);
  if (missing.length === 0) {
    console.log("[backfill] 받을 날짜가 없습니다.");
    return;
  }

  // 연속한 날짜를 chunk 크기로 묶는다. 빠진 날짜가 흩어져 있으면 그만큼 요청이 는다.
  const groups: string[][] = [];
  for (const d of missing) {
    const last = groups.at(-1);
    if (last && last.length < chunk && addDays(last.at(-1)!, 1) === d) last.push(d);
    else groups.push([d]);
  }

  console.log(`[backfill] ${groups.length}회 나눠 받습니다 (한 번에 최대 ${chunk}일)\n`);

  let okDays = 0;
  let failedGroups = 0;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const span = `${g[0]}~${g.at(-1)}`;
    console.log(`[backfill] ${i + 1}/${groups.length} — ${span} (${g.length}일)`);

    const res = await downloadOilPrice(g[0], g.at(-1)!, 2);
    if (!res) {
      console.warn(`[backfill] ${span} 실패 — 건너뜁니다. 다시 실행하면 이어서 받습니다.`);
      failedGroups++;
      continue;
    }

    const rows = parseOilPriceFile(res.buffer, res.filename);

    // 날짜별로 나눠 각각 그날의 시세로 계수를 낸다.
    const byDate = new Map<string, Array<{ stationId: string; sido: string; gasoline: number | null; diesel: number | null }>>();
    for (const r of rows) {
      const region = normalizeRegion(r.region) ?? normalizeRegion(r.address);
      if (!region) continue;
      const arr = byDate.get(r.date);
      const row = { stationId: r.stationId, sido: region.sido, gasoline: r.gasoline, diesel: r.diesel };
      if (arr) arr.push(row); else byDate.set(r.date, [row]);
    }

    for (const [date, dayRows] of [...byDate.entries()].sort()) {
      const samples = sampleDay(dayRows, ids, (sido) => greenRankWith(sido, th), th.rankYellowFactor);
      mergeDay(history, date, samples);
      okDays++;
      console.log(`         ${date} — 전국 ${dayRows.length}건, 착한주유소 ${samples.size}곳`);
    }

    // 매 묶음마다 저장한다. 중간에 끊겨도 여기까지는 남는다.
    mkdirSync(DATA, { recursive: true });
    history.generatedAt = new Date().toISOString();
    writeFileSync(HISTORY, JSON.stringify(history), "utf8");
  }

  const dropped = pruneTo(history, ids);
  history.generatedAt = new Date().toISOString();
  writeFileSync(HISTORY, JSON.stringify(history), "utf8");

  console.log(`\n[backfill] 완료 — 새로 채운 날짜 ${okDays}일`);
  if (failedGroups) console.log(`  실패한 묶음 ${failedGroups}개 — 다시 실행하면 이어서 받습니다.`);
  if (dropped) console.log(`  명단에서 빠진 주유소 ${dropped}곳 정리`);
  console.log(`  날짜축 ${history.dates.length}일 (${history.dates[0]} ~ ${history.dates.at(-1)})`);
  console.log(`  주유소 ${Object.keys(history.stations).length}곳`);
  console.log(`  data/history.json`);
}

main().catch((e) => { console.error("[backfill] 예외:", e); process.exit(1); });
