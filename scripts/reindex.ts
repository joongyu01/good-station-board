/**
 * 보조 — 이미 받아둔 원본을 재수집 없이 다시 정규화한다.
 *
 * src/lib/region.ts 의 규칙을 고쳤을 때 쓴다. data/raw/{날짜}.json.gz 는 Opinet
 * 원본 `region` 문자열을 그대로 보관하고 있으므로, 스크래핑을 다시 하지 않고도
 * 시·도/시·군·구를 다시 계산할 수 있다.
 *
 * 실행: npm run reindex
 */
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listRawDates, readRaw, writeRaw } from "../src/lib/raw.ts";
import { normalizeRegion } from "../src/lib/region.ts";
import type { EnrichedRow } from "./collect.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const DATA = path.join(ROOT, "data");

function main() {
  if (!existsSync(RAW_DIR)) {
    console.error("data/raw 가 없습니다. 먼저 `npm run collect`.");
    process.exit(1);
  }

  const dates = listRawDates(RAW_DIR);
  if (dates.length === 0) {
    console.error("data/raw 에 수집분이 없습니다.");
    process.exit(1);
  }

  const index: Record<string, { name: string; address: string; region: string; sido: string; sigungu: string; brand: string }> = {};
  let totalDropped = 0;

  for (const date of dates) {
    const payload = readRaw<{ date: string; collectedAt?: string; rows: EnrichedRow[] }>(RAW_DIR, date);
    if (!payload) continue;

    const rows: EnrichedRow[] = [];
    let dropped = 0;

    for (const r of payload.rows) {
      const region = normalizeRegion(r.region) ?? normalizeRegion(r.address);
      if (!region) { dropped++; continue; }
      rows.push({
        ...r,
        sido: region.sido,
        normSido: region.sido,
        sigungu: region.sigungu,
        normKey: region.key,
      });
    }

    writeRaw(RAW_DIR, date, { ...payload, rows });
    totalDropped += dropped;
    console.log(`  ${date}: ${rows.length}건 재정규화 (제외 ${dropped})`);

    for (const r of rows) {
      index[r.stationId] = {
        name: r.stationName, address: r.address, region: r.region,
        sido: r.sido, sigungu: r.sigungu, brand: r.brand,
      };
    }
  }

  writeFileSync(path.join(DATA, "station-index.json"), JSON.stringify(index, null, 0), "utf8");
  console.log(`\n재정규화 완료 — ${dates.length}일치, 주유소 인덱스 ${Object.keys(index).length}개, 제외 ${totalDropped}건`);
}

main();
