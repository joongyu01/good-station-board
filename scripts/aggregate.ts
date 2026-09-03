/**
 * 4단계 — 시군구 통계 산출 및 신호등 판정
 *
 *   data/raw/{date}.json + good-stations + station-mapping + station-coords
 *     → client/public/data/board-{date}.json
 *     → client/public/data/latest.json      (현황판이 읽는 파일)
 *     → client/public/data/index.json       (보유 날짜 목록)
 *
 * 실행:
 *   npm run aggregate           가장 최근 수집분
 *   npm run aggregate 20260902  특정 날짜
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegionStats, computeZ, toSignal, describe, rankOf, MIN_SAMPLE } from "../src/lib/signal.ts";
import { FUEL_TYPES, type BoardData, type FuelType, type GoodStation, type RegionStat, type StationSignal } from "../src/lib/types.ts";
import { regionKey } from "../src/lib/region.ts";
import type { EnrichedRow } from "./collect.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const RAW_DIR = path.join(DATA, "raw");
const OUT_DIR = path.join(ROOT, "client", "public", "data");

/**
 * 일별 스냅샷 보관 일수.
 *
 * 하루치가 700KB 남짓이라 매일 커밋하면 저장소가 연 250MB씩 불어난다. 현황판은
 * 당일 상태를 보는 화면이고 과거 추이는 요구사항이 아니므로 최근 것만 남긴다.
 * 장기 이력이 필요해지면 이 값을 늘리는 대신 별도 저장소나 DB로 빼는 편이 낫다.
 */
const KEEP_DAYS = 30;

function latestRawDate(): string | null {
  if (!existsSync(RAW_DIR)) return null;
  const dates = readdirSync(RAW_DIR)
    .filter((f) => /^\d{8}\.json$/.test(f))
    .map((f) => f.slice(0, 8))
    .sort();
  return dates.at(-1) ?? null;
}

function main() {
  const dateArg = process.argv.slice(2).find((a) => /^\d{8}$/.test(a));
  const date = dateArg ?? latestRawDate();

  if (!date) {
    console.error("수집된 데이터가 없습니다. 먼저 `npm run collect`.");
    process.exit(1);
  }

  const rawPath = path.join(RAW_DIR, `${date}.json`);
  if (!existsSync(rawPath)) {
    console.error(`data/raw/${date}.json 이 없습니다.`);
    process.exit(1);
  }

  const raw: { date: string; rows: EnrichedRow[] } = JSON.parse(readFileSync(rawPath, "utf8"));
  const good: GoodStation[] = JSON.parse(readFileSync(path.join(DATA, "good-stations.json"), "utf8"));

  const mappingPath = path.join(DATA, "station-mapping.json");
  const mapping: Record<string, { stationId: string }> = existsSync(mappingPath)
    ? JSON.parse(readFileSync(mappingPath, "utf8")) : {};

  const coordsPath = path.join(DATA, "station-coords.json");
  const coords: Record<string, { lat: number; lng: number }> = existsSync(coordsPath)
    ? JSON.parse(readFileSync(coordsPath, "utf8")) : {};

  console.log(`[aggregate] 기준일 ${date} — 전국 ${raw.rows.length}건`);

  // ── 시군구 × 유종 통계 ──────────────────────────────────────────────
  const stats = buildRegionStats(raw.rows, FUEL_TYPES);
  console.log(`[aggregate] 시군구 통계 ${stats.size}건 (${FUEL_TYPES.length}개 유종 × 시군구)`);

  // 순위 계산을 위해 시군구별 정렬된 가격 목록을 따로 둔다.
  const sortedPrices = new Map<string, number[]>();
  for (const fuel of FUEL_TYPES) {
    const buckets = new Map<string, number[]>();
    for (const r of raw.rows) {
      const p = r[fuel];
      if (p == null || p <= 0) continue;
      const k = regionKey(r.sido, r.sigungu);
      const arr = buckets.get(k);
      if (arr) arr.push(p); else buckets.set(k, [p]);
    }
    for (const [k, v] of buckets) sortedPrices.set(`${k}|${fuel}`, describe(v).sorted);
  }

  // ── 착한주유소 가격 조회 ────────────────────────────────────────────
  const priceById = new Map<string, EnrichedRow>();
  for (const r of raw.rows) priceById.set(r.stationId, r);

  const signals: StationSignal[] = [];
  let matchedCount = 0;

  for (const g of good) {
    const stationId = mapping[String(g.seq)]?.stationId ?? null;
    if (stationId) matchedCount++;
    const row = stationId ? priceById.get(stationId) : undefined;
    const coord = stationId ? coords[stationId] : undefined;

    // 비교 기준 지역은 Opinet이 말하는 현재 소재지를 쓴다.
    //
    // 명단의 주소는 행정구역 개편을 못 따라간 경우가 있다. 인천 서구는 검단구·
    // 서해구로 분구되었는데 명단은 아직 `서구`라서, 명단 기준으로 통계를 찾으면
    // 존재하지 않는 지역이 되어 신호등이 전부 '미상'으로 떨어진다.
    // 매칭이 끝난 주유소는 Opinet 쪽 지역이 정답이다.
    const effSido = row?.sido ?? g.sido;
    const effSigungu = row?.sigungu ?? g.sigungu;
    const effKey = row ? regionKey(row.sido, row.sigungu) : g.regionKey;

    // 일반구는 오피넷이 주지 않으므로 명단 주소에서 가져온다.
    // 명단의 시와 오피넷의 시가 같을 때만 신뢰한다 — 다르면 개편으로 어긋난 것이라
    // 구 이름을 그대로 붙이면 엉뚱한 곳에 꽂힌다.
    const detailParts = g.sigunguDetail.split(" ");
    const district =
      detailParts.length > 1 && detailParts[0] === effSigungu ? detailParts[1] : null;

    for (const fuel of FUEL_TYPES) {
      const price = row?.[fuel] ?? null;
      const stat = stats.get(`${effKey}|${fuel}`);
      const sorted = sortedPrices.get(`${effKey}|${fuel}`) ?? [];

      let z: number | null = null;
      let diff: number | null = null;
      let rank: number | null = null;

      if (price != null && stat) {
        z = computeZ(price, stat);
        diff = Math.round((price - stat.mean) * 10) / 10;
        rank = rankOf(price, sorted);
      }

      signals.push({
        seq: g.seq,
        stationId,
        name: g.name,
        sido: effSido,
        sigungu: effSigungu,
        regionKey: effKey,
        district,
        lat: coord?.lat ?? null,
        lng: coord?.lng ?? null,
        fuelType: fuel,
        price,
        regionMean: stat?.mean ?? null,
        diff,
        zScore: z == null ? null : Math.round(z * 1000) / 1000,
        signal: toSignal(z),
        isRegionLowest: price != null && sorted.length > 0 && price === sorted[0],
        regionRank: rank,
        regionN: stat?.n ?? 0,
        lowSample: stat?.fallback ?? false,
      });
    }
  }

  // ── 요약 ────────────────────────────────────────────────────────────
  const byFuel: BoardData["summary"]["byFuel"] = {};
  for (const fuel of FUEL_TYPES) {
    const subset = signals.filter((s) => s.fuelType === fuel);
    byFuel[fuel] = {
      green: subset.filter((s) => s.signal === "green").length,
      yellow: subset.filter((s) => s.signal === "yellow").length,
      red: subset.filter((s) => s.signal === "red").length,
      unknown: subset.filter((s) => s.signal === "unknown").length,
    };
  }

  // 현황판이 쓰는 시군구 통계는 착한주유소가 있는 지역만 실으면 충분하다.
  const usedRegions = new Set(signals.map((s) => s.regionKey));
  const regions: RegionStat[] = [...stats.values()].filter((s) => usedRegions.has(s.regionKey));

  const board: BoardData = {
    date,
    generatedAt: new Date().toISOString(),
    stations: signals,
    regions,
    summary: { total: good.length, matched: matchedCount, byFuel },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, `board-${date}.json`), JSON.stringify(board), "utf8");
  writeFileSync(path.join(OUT_DIR, "latest.json"), JSON.stringify(board), "utf8");

  // 보관 기간을 넘긴 스냅샷 정리
  const all = readdirSync(OUT_DIR)
    .filter((f) => /^board-\d{8}\.json$/.test(f))
    .map((f) => f.slice(6, 14))
    .sort()
    .reverse();

  const stale = all.slice(KEEP_DAYS);
  for (const d of stale) rmSync(path.join(OUT_DIR, `board-${d}.json`), { force: true });
  if (stale.length) console.log(`[aggregate] 오래된 스냅샷 ${stale.length}건 정리 (보관 ${KEEP_DAYS}일)`);

  const available = all.slice(0, KEEP_DAYS);
  writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify({ dates: available }), "utf8");

  // ── 콘솔 요약 ───────────────────────────────────────────────────────
  const g = byFuel.gasoline;
  const lowSampleRegions = regions.filter((r) => r.fallback && r.fuelType === "gasoline").length;
  console.log(`[aggregate] 완료 — 기준일 ${date}`);
  console.log(`  매칭된 착한주유소: ${matchedCount}/${good.length}`);
  console.log(`  휘발유 신호등: 초록 ${g.green} / 노랑 ${g.yellow} / 빨강 ${g.red} / 미상 ${g.unknown}`);
  console.log(`  표본부족(n<${MIN_SAMPLE}) 시군구: ${lowSampleRegions}개 — 시·도 σ로 대체`);
  console.log(`\n  client/public/data/latest.json`);
}

main();
