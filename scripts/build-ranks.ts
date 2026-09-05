/**
 * 보조 — 보관 중인 원본으로 순위표를 만든다.
 *
 *   data/raw/{date}.json.gz  →  client/public/data/rank-{date}.json
 *
 * aggregate 는 그날 것 하나만 만든다. 원본을 남기기 시작했으니 과거 날짜도
 * 다시 긁지 않고 여기서 채울 수 있다.
 *
 * 실행:
 *   npm run ranks              보관 중인 원본 전부
 *   npm run ranks 20260902     특정 날짜
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRanks } from "../src/lib/rank.ts";
import { listRawDates, readRaw } from "../src/lib/raw.ts";
import { DEFAULT_THRESHOLDS, type Thresholds } from "../src/lib/signal.ts";
import type { GoodStation } from "../src/lib/types.ts";
import type { EnrichedRow } from "./collect.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const RAW_DIR = path.join(DATA, "raw");
const OUT_DIR = path.join(ROOT, "client", "public", "data");

function main() {
  const only = process.argv.slice(2).filter((a) => /^\d{8}$/.test(a));
  const dates = only.length ? only : listRawDates(RAW_DIR);

  if (dates.length === 0) {
    console.error("보관 중인 원본이 없습니다. 먼저 `npm run collect`.");
    process.exit(1);
  }

  const good: GoodStation[] = JSON.parse(
    readFileSync(path.join(DATA, "good-stations.json"), "utf8"),
  );
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

  mkdirSync(OUT_DIR, { recursive: true });
  let made = 0;

  for (const date of dates) {
    const raw = readRaw<{ rows: EnrichedRow[] }>(RAW_DIR, date);
    if (!raw) { console.warn(`  ${date} — 원본 없음, 건너뜀`); continue; }

    const file = buildRanks(raw.rows, ids, th, date);
    const out = path.join(OUT_DIR, `rank-${date}.json`);
    writeFileSync(out, JSON.stringify(file), "utf8");
    made++;
    console.log(`  ${date} — 시·도 ${Object.keys(file.regions).length}개`);
  }

  // 화면의 날짜 선택이 읽는 목록을 갱신한다.
  const indexPath = path.join(OUT_DIR, "index.json");
  const index: { dates?: string[]; ranks?: string[] } = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
  const ranks = new Set(index.ranks ?? []);
  for (const d of dates) ranks.add(d);
  index.ranks = [...ranks].sort().reverse();
  writeFileSync(indexPath, JSON.stringify(index), "utf8");

  console.log(`[ranks] 완료 — ${made}일`);
}

main();
