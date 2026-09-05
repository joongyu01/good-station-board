/**
 * 2단계 — Opinet 전국 주유소 가격 수집
 *
 *   Opinet opDownload.do  →  data/raw/{YYYYMMDD}.json  +  data/station-index.json
 *
 * 전국 약 1.1만 개 주유소 가격이 필요한 이유는 표준편차 때문이다. 착한주유소
 * 449곳만 받아서는 시군구 내 가격 분포를 알 수 없고, σ 없이는 신호등을 못 만든다.
 *
 * 실행:
 *   npm run collect              어제~오늘 중 올라온 가장 최근 날짜
 *   npm run collect 20260902     특정 날짜
 *   npm run collect --file=x.csv 이미 받아둔 파일로 (스크래핑 생략)
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadOilPrice } from "../src/lib/opinet/scraper.ts";
import { parseOilPriceFile } from "../src/lib/opinet/parser.ts";
import { normalizeRegion } from "../src/lib/region.ts";
import { writeRaw } from "../src/lib/raw.ts";
import type { StationPriceRow } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const DATA_DIR = path.join(ROOT, "data");

/** Asia/Seoul 기준 오늘. */
function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

/** Asia/Seoul 기준 어제. */
function yesterdayKST(): string {
  const now = new Date(Date.now() + 9 * 3600 * 1000); // UTC→KST
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * 그날 치가 다 올라왔다고 볼 최소 비율.
 *
 * 오피넷은 당일분을 하루에 걸쳐 채운다. 아직 채우는 중인 데이터를 그날의
 * 최신분으로 삼으면 전국 표본이 모자란 채로 순위를 매기게 된다. 전날 건수의
 * 이 비율에 못 미치면 아직 이르다고 보고 전날 것을 쓴다.
 */
const COMPLETE_RATIO = 0.8;

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

  let buffer: Buffer;
  let filename: string;

  if (fileArg) {
    console.log(`[collect] 로컬 파일 사용: ${fileArg}`);
    buffer = readFileSync(fileArg);
    filename = path.basename(fileArg);
  } else if (dateArg) {
    console.log(`[collect] Opinet 수집 시작 — 기준일 ${dateArg}`);
    const result = await downloadOilPrice(dateArg);
    if (!result) {
      console.error(`[collect] 수집 실패 — 기준일 ${dateArg}. 직전 데이터를 유지합니다.`);
      process.exit(2);
    }
    buffer = result.buffer;
    filename = result.filename;
  } else {
    // 어제~오늘을 한 번에 받는다.
    //
    // 오피넷은 당일분도 그날 중에 올린다(9/5 17시에 이미 10,223건). 그런데
    // '어제'만 받으면 현황판이 늘 하루 뒤처진다. 그렇다고 오늘을 먼저 받아 보고
    // 없으면 어제를 다시 받는 식으로 두 번 두드리면 NetFunnel 대기열을 두 번
    // 통과해야 해서 실행 시간이 배로 든다.
    //
    // 기간 조회는 한 번에 두 날짜를 다 준다. 오늘 치가 아직 없으면 어제 것만
    // 담겨 오므로 자연스럽게 어제로 떨어진다.
    const from = yesterdayKST();
    const to = todayKST();
    console.log(`[collect] Opinet 수집 시작 — ${from}~${to}`);
    const result = await downloadOilPrice(from, to);
    if (!result) {
      // 실패는 정상 범주다. 직전 성공분이 남아 있으면 현황판은 계속 뜬다.
      console.error(`[collect] 수집 실패 — ${from}~${to}. 직전 데이터를 유지합니다.`);
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

  // 날짜별로 가른다. 기간 조회면 두 날짜가 섞여 온다.
  const byDate = new Map<string, EnrichedRow[]>();
  for (const r of rows) {
    const arr = byDate.get(r.date);
    if (arr) arr.push(r); else byDate.set(r.date, [r]);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) {
    console.error("[collect] 날짜를 가려내지 못했습니다.");
    process.exit(3);
  }

  mkdirSync(RAW_DIR, { recursive: true });
  for (const d of dates) {
    const part = byDate.get(d)!;
    const bytes = writeRaw(RAW_DIR, d, { date: d, collectedAt: new Date().toISOString(), rows: part });
    console.log(`  data/raw/${d}.json.gz  (${part.length}건, ${Math.round(bytes / 1024)}KB)`);
  }

  // 가장 최근 날짜를 기준일로 삼되, 아직 채우는 중이면 전날로 물러선다.
  let actualDate = dates.at(-1)!;
  if (dates.length > 1) {
    const latest = byDate.get(actualDate)!.length;
    const prev = byDate.get(dates.at(-2)!)!.length;
    if (latest < prev * COMPLETE_RATIO) {
      console.log(
        `[collect] ${actualDate} 는 ${latest}건으로 전날(${prev}건)의 ` +
        `${Math.round((latest / prev) * 100)}% 뿐입니다. 아직 올라오는 중으로 보고 ` +
        `${dates.at(-2)} 를 기준일로 씁니다.`,
      );
      actualDate = dates.at(-2)!;
    }
  }

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

  console.log(`[collect] 완료 — 기준일 ${actualDate} (받은 날짜 ${dates.join(", ")})`);
  console.log(`  data/station-index.json      (누적 ${Object.keys(index).length}개 주유소)`);
}

main().catch((err) => {
  console.error("[collect] 예외:", err);
  process.exit(1);
});
