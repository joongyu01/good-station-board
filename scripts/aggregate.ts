/**
 * 4단계 — 시·도 통계 산출 및 신호등 판정
 *
 *   data/raw/{date}.json + good-stations + station-mapping + station-coords
 *     → client/public/data/board-{date}.json
 *     → client/public/data/latest.json      (현황판이 읽는 파일)
 *     → client/public/data/index.json       (보유 날짜 목록)
 *
 * 판정 단위는 **주유소 1곳**이다. 점수가 휘발유+경유 합계 하나로 나오므로
 * 유종별로 신호등을 따로 매기지 않는다.
 *
 * 실행:
 *   npm run aggregate           가장 최근 수집분
 *   npm run aggregate 20260902  특정 날짜
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  toSignal, describe, rankOf, greenRankWith, greenBaseOf, coefficientOf,
  DEFAULT_THRESHOLDS, type Thresholds,
} from "../src/lib/signal.ts";
import {
  FUEL_TYPES,
  type BoardData, type FuelType, type GoodStation, type RegionStat, type StationSignal,
} from "../src/lib/types.ts";
import { regionKey } from "../src/lib/region.ts";
import { emptyHistory, mergeDay, pruneTo, sampleDay, type History } from "../src/lib/history.ts";
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

  // 관리 화면에서 바꾼 임계값. 없으면 코드 기본값을 쓴다.
  const thPath = path.join(DATA, "thresholds.json");
  const th: Thresholds = existsSync(thPath)
    ? { ...DEFAULT_THRESHOLDS, ...JSON.parse(readFileSync(thPath, "utf8")) }
    : DEFAULT_THRESHOLDS;

  const coordsPath = path.join(DATA, "station-coords.json");
  const coords: Record<string, { lat: number; lng: number }> = existsSync(coordsPath)
    ? JSON.parse(readFileSync(coordsPath, "utf8")) : {};

  console.log(`[aggregate] 기준일 ${date} — 전국 ${raw.rows.length}건`);

  // ── 시·도 통계 ──────────────────────────────────────────────────────
  //
  // 비교 모집단은 시·도다. 시·군·구로 쪼개면 주유소가 두세 곳뿐인 곳이 생겨
  // "관내 1위"가 아무 의미도 없어진다. 시·도는 가장 작은 세종도 64곳이라
  // 순위가 뜻을 갖는다.
  //
  // 유종별 통계는 화면 표시용이고, 순위와 계수는 모두 합계("sum") 분포에서 낸다.
  const stats = new Map<string, RegionStat>();
  const sortedPrices = new Map<string, number[]>();

  function put(sido: string, kind: RegionStat["fuelType"], values: number[]) {
    const d = describe(values);
    sortedPrices.set(`${sido}|${kind}`, d.sorted);
    stats.set(`${sido}|${kind}`, {
      regionKey: sido,
      sido,
      sigungu: "",
      fuelType: kind,
      n: d.n,
      mean: Math.round(d.mean * 100) / 100,
      stdev: Math.round(d.stdev * 100) / 100,
      min: d.min,
      max: d.max,
      fallback: false,
      basisKey: sido,
    });
  }

  for (const fuel of FUEL_TYPES) {
    const buckets = new Map<string, number[]>();
    for (const r of raw.rows) {
      const p = r[fuel];
      if (p == null || p <= 0) continue;
      const arr = buckets.get(r.sido);
      if (arr) arr.push(p); else buckets.set(r.sido, [p]);
    }
    for (const [sido, values] of buckets) put(sido, fuel, values);
  }

  // 합계 모집단 — 휘발유와 경유를 **모두** 파는 주유소만. 한 유종만 파는 곳은
  // 합계가 없으니 순위표에 끼워 넣을 수 없다.
  const sumBuckets = new Map<string, number[]>();
  for (const r of raw.rows) {
    const g = r.gasoline;
    const d = r.diesel;
    if (g == null || g <= 0 || d == null || d <= 0) continue;
    const arr = sumBuckets.get(r.sido);
    if (arr) arr.push(g + d); else sumBuckets.set(r.sido, [g + d]);
  }
  for (const [sido, values] of sumBuckets) put(sido, "sum", values);

  console.log(`[aggregate] 시·도 통계 ${stats.size}건 (유종 ${FUEL_TYPES.length}종 + 합계)`);

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

    // 신호등 기준 순위. 서울·경기는 10위, 그 밖의 시·도는 5위 이내가 상위권.
    const greenRank = greenRankWith(effSido, th);

    const prices = {} as Record<FuelType, number | null>;
    for (const fuel of FUEL_TYPES) prices[fuel] = row?.[fuel] ?? null;

    // 순위와 계수 모두 합계 분포에서 낸다.
    const sumStat = stats.get(`${effSido}|sum`);
    const sumSorted = sortedPrices.get(`${effSido}|sum`) ?? [];
    const sum =
      prices.gasoline != null && prices.diesel != null ? prices.gasoline + prices.diesel : null;

    // 계수 1.000 = 초록불 커트라인. 상위권이면 1 이하로 떨어진다.
    const idx = coefficientOf(sum, greenBaseOf(sumSorted, greenRank));

    const rank = sum != null && sumSorted.length > 0 ? rankOf(sum, sumSorted) : null;
    const regionMinSum = sumSorted.length > 0 ? sumSorted[0] : null;
    const gap = sum != null && regionMinSum != null ? sum - regionMinSum : null;

    signals.push({
      seq: g.seq,
      stationId,
      name: g.name,
      brand: g.brand ?? null,
      isSelf: g.isSelf ?? false,
      sido: effSido,
      sigungu: effSigungu,
      regionKey: effKey,
      district,
      lat: coord?.lat ?? null,
      lng: coord?.lng ?? null,
      prices,
      sum,
      priceIndex: idx,
      regionMinSum,
      regionMeanSum: sumStat?.mean ?? null,
      gapFromMin: gap,
      regionRank: rank,
      regionN: sumStat?.n ?? 0,
      greenRank,
      isRegionLowest: sum != null && regionMinSum != null && sum === regionMinSum,
      signal: toSignal(rank, greenRank, th.rankYellowFactor, sumStat?.n ?? 0),
    });
  }

  // ── 요약 ────────────────────────────────────────────────────────────
  const counts = {
    green: signals.filter((s) => s.signal === "green").length,
    yellow: signals.filter((s) => s.signal === "yellow").length,
    red: signals.filter((s) => s.signal === "red").length,
    unknown: signals.filter((s) => s.signal === "unknown").length,
  };

  // 시·도 통계는 전부 실어도 50건이 안 된다.
  const regions: RegionStat[] = [...stats.values()];

  const board: BoardData = {
    date,
    generatedAt: new Date().toISOString(),
    stations: signals,
    regions,
    summary: { total: good.length, matched: matchedCount, counts },
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

  // ── 시계열 ──────────────────────────────────────────────────────────
  //
  // 오늘치를 data/history.json 에 얹고 화면이 읽을 곳으로 복사한다. 과거치는
  // `npm run backfill` 이 채운다. 여기서는 하루씩 이어붙이기만 한다.
  const historyPath = path.join(DATA, "history.json");
  const history: History = existsSync(historyPath)
    ? JSON.parse(readFileSync(historyPath, "utf8")) : emptyHistory();

  const ids = new Set<string>();
  for (const s of signals) if (s.stationId) ids.add(s.stationId);

  mergeDay(history, date, sampleDay(raw.rows, ids, (sido) => greenRankWith(sido, th)));
  const droppedSeries = pruneTo(history, ids);
  history.generatedAt = new Date().toISOString();

  writeFileSync(historyPath, JSON.stringify(history), "utf8");
  writeFileSync(path.join(OUT_DIR, "history.json"), JSON.stringify(history), "utf8");

  // ── 콘솔 요약 ───────────────────────────────────────────────────────
  const withIndex = signals.filter((s) => s.priceIndex).length;
  console.log(`[aggregate] 완료 — 기준일 ${date}`);
  console.log(`  매칭된 착한주유소: ${matchedCount}/${good.length}`);
  console.log(`  신호등: 상위권 ${counts.green} / 근접 ${counts.yellow} / 미달 ${counts.red} / 미상 ${counts.unknown}`);
  console.log(`  합산 계수 산출: ${withIndex}곳 (1.000 = 초록불 커트라인)`);
  console.log(`  적용 기준: 서울·경기 ${th.rankGreenMetro}위 / 그 외 ${th.rankGreenDefault}위 이내 상위권, 근접은 ${th.rankYellowFactor}배까지`);
  console.log(`\n  client/public/data/latest.json`);
}

main();
