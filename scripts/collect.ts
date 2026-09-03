/**
 * 2단계 — Opinet 전국 주유소 가격 수집
 *
 *   Opinet opDownload.do  →  data/raw/{YYYYMMDD}.json  +  data/station-index.json
 *
 * 전국 약 1.1만 개 주유소 가격이 필요한 이유는 표준편차 때문이다. 착한주유소
 * 449곳만 받아서는 시군구 내 가격 분포를 알 수 없고, σ 없이는 신호등을 못 만든다.
 *
 * 실행:
 *   npm run collect              어제 날짜
 *   npm run collect 20260902     특정 날짜
 *   npm run collect --file=x.csv 이미 받아둔 파일로 (스크래핑 생략)
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadOilPrice } from "../src/lib/opinet/scraper.ts";
import { parseOilPriceFile } from "../src/lib/opinet/parser.ts";
import { normalizeRegion } from "../src/lib/region.ts";
import type { StationPriceRow } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const DATA_DIR = path.join(ROOT, "data");

/** Asia/Seoul 기준 어제. Opinet 과거판매가격은 당일분이 늦게 올라온다. */
function yesterdayKST(): string {
  const now = new Date(Date.now() + 9 * 3600 * 1000); // UTC→KST
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

/** 수집한 행에 정규화된 시군구를 붙인다. 집계 단계에서 바로 쓰기 위함. */
export interface EnrichedRow extends StationPriceRow {
  sigungu: string;
  normSido: string;
  normKey: string;
}

function enrich(rows: StationPriceRow[]): { rows: EnrichedRow[]; dropped: number } {
  const out: EnrichedRow[] = [];
  let dropped = 0;

  for (const r of rows) {
    // 지역 컬럼을 먼저 보고, 실패하면 주소로 재시도한다.
    const region = normalizeRegion(r.region) ?? normalizeRegion(r.address);
    if (!region) { dropped++; continue; }
    out.push({
      ...r,
      sido: region.sido,
      normSido: region.sido,
      sigungu: region.sigungu,
      normKey: region.key,
    });
  }
  return { rows: out, dropped };
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith("--file="))?.slice("--file=".length);
  const dateArg = args.find((a) => /^\d{8}$/.test(a));
  const targetDate = dateArg ?? yesterdayKST();

  let buffer: Buffer;
  let filename: string;

  if (fileArg) {
    console.log(`[collect] 로컬 파일 사용: ${fileArg}`);
    buffer = readFileSync(fileArg);
    filename = path.basename(fileArg);
  } else {
    console.log(`[collect] Opinet 수집 시작 — 기준일 ${targetDate}`);
    const result = await downloadOilPrice(targetDate);
    if (!result) {
      // 실패는 정상 범주다. 직전 성공분이 남아 있으면 현황판은 계속 뜬다.
      console.error(`[collect] 수집 실패 — 기준일 ${targetDate}. 직전 데이터를 유지합니다.`);
      process.exit(2);
    }
    buffer = result.buffer;
    filename = result.filename;
  }

  const parsed = parseOilPriceFile(buffer, filename);
  console.log(`[collect] 파싱: ${parsed.length}건`);
  if (parsed.length === 0) {
    console.error("[collect] 파싱 결과가 비어 있습니다. 파일 형식이 바뀌었을 수 있습니다.");
    process.exit(3);
  }

  const { rows, dropped } = enrich(parsed);
  console.log(`[collect] 지역 정규화: ${rows.length}건 성공, ${dropped}건 제외`);

  const actualDate = rows[0]?.date || targetDate;
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(
    path.join(RAW_DIR, `${actualDate}.json`),
    JSON.stringify({ date: actualDate, collectedAt: new Date().toISOString(), rows }),
    "utf8",
  );

  // 주유소 인덱스 — 매칭 단계가 쓴다. 가격은 빼고 식별 정보만 누적한다.
  const indexPath = path.join(DATA_DIR, "station-index.json");
  const index: Record<string, { name: string; address: string; region: string; sido: string; sigungu: string; brand: string }> =
    existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};

  for (const r of rows) {
    index[r.stationId] = {
      name: r.stationName,
      address: r.address,
      region: r.region,
      sido: r.sido,
      sigungu: r.sigungu,
      brand: r.brand,
    };
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 0), "utf8");

  console.log(`[collect] 완료 — 기준일 ${actualDate}`);
  console.log(`  data/raw/${actualDate}.json  (${rows.length}건)`);
  console.log(`  data/station-index.json      (누적 ${Object.keys(index).length}개 주유소)`);
}

main().catch((err) => {
  console.error("[collect] 예외:", err);
  process.exit(1);
});
