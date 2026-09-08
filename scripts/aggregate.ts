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
import { readFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { writeJsonIfChanged } from "../src/lib/stable-write.ts";
import {
  CONFIRMED_ROUNDS, DRIFT_GREEN, DRIFT_YELLOW, driftSignalOf, median, ROUND_ANNOUNCED, worseOf,
  type AdjustedMetric, type Baseline,
} from "../src/lib/adjust.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  toSignal, describe, distinctAsc, rankOf, greenRankWith, greenBaseOf, coefficientOf,
  DEFAULT_THRESHOLDS, type Thresholds,
} from "../src/lib/signal.ts";
import {
  FUEL_TYPES,
  VIEW_MODES,
  emptyCounts,
  type BoardData, type FuelMetric, type FuelType, type GoodStation,
  type RegionStat, type SignalColor, type StationSignal, type ViewMode,
} from "../src/lib/types.ts";
import { basisSido, regionKey } from "../src/lib/region.ts";
import { buildRanks } from "../src/lib/rank.ts";
import { adjustedSignalOf, cutoffsOf } from "../src/lib/judge.ts";
import { hasRaw, listRawDates, readRaw } from "../src/lib/raw.ts";
import {
  COMPLIANCE_FROM, complianceOf, emptyHistory, mergeDay, mergeRegionMean, overDaysOf,
  overRegionOf, pruneTo, regionMeanOf, sampleDay,
  type History,
} from "../src/lib/history.ts";
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

/** 견줄 때 무시할 시각 필드. 이것만 다르면 안 바뀐 것으로 본다. */
const TIMESTAMP = ["generatedAt"] as const;

function latestRawDate(): string | null {
  return listRawDates(RAW_DIR).at(-1) ?? null;
}

function main() {
  const dateArg = process.argv.slice(2).find((a) => /^\d{8}$/.test(a));
  const date = dateArg ?? latestRawDate();

  if (!date) {
    console.error("수집된 데이터가 없습니다. 먼저 `npm run collect`.");
    process.exit(1);
  }

  if (!hasRaw(RAW_DIR, date)) {
    console.error(`data/raw/${date}.json(.gz) 이 없습니다.`);
    process.exit(1);
  }

  const raw = readRaw<{ date: string; rows: EnrichedRow[] }>(RAW_DIR, date)!;
  const good: GoodStation[] = JSON.parse(readFileSync(path.join(DATA, "good-stations.json"), "utf8"));

  const mappingPath = path.join(DATA, "station-mapping.json");
  const mapping: Record<string, { stationId: string }> = existsSync(mappingPath)
    ? JSON.parse(readFileSync(mappingPath, "utf8")) : {};

  /**
   * 명단 원본에서 들여온 차수. 화면이 상호 옆에 붙이고 그래프에 선정 시점을 긋는다.
   *
   * 없으면 CSV 의 최초 차수 하나로 갈음한다 — 다시 뽑힌 이력은 그 파일에만 있다.
   */
  const roundsPath = path.join(DATA, "station-rounds.json");
  const roundSrc: { stations: Record<string, { rounds: string[] }> } | null =
    existsSync(roundsPath) ? JSON.parse(readFileSync(roundsPath, "utf8")) : null;
  const roundsOf = (g: GoodStation): string[] =>
    (g.stationId ? roundSrc?.stations[g.stationId]?.rounds : null) ?? (g.round ? [g.round] : []);

  // 관리 화면에서 바꾼 임계값. 없으면 코드 기본값을 쓴다.
  const thPath = path.join(DATA, "thresholds.json");
  const th: Thresholds = existsSync(thPath)
    ? { ...DEFAULT_THRESHOLDS, ...JSON.parse(readFileSync(thPath, "utf8")) }
    : DEFAULT_THRESHOLDS;

  // 보정 판정의 기준선. 없으면 보정 값 없이 현재 방식만 싣는다.
  const baselinePath = path.join(DATA, "baseline.json");
  const baseline: Baseline | null = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
  if (!baseline) {
    console.warn("[aggregate] data/baseline.json 이 없습니다. 보정 판정을 건너뜁니다 — npm run baseline");
  }
  const excluded = new Set<string>(baseline?.excluded ?? []);

  // 보정 판정의 결합 방식과 이탈률 임계값.
  const combine = th.adjustedCombine ?? "both";
  const driftGreen = th.driftGreen ?? DRIFT_GREEN;
  const driftYellow = th.driftYellow ?? DRIFT_YELLOW;

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
  /** 서로 다른 값만 남긴 목록. 순위는 조밀 순위라 이걸 기준으로 센다. */
  const distinctPrices = new Map<string, number[]>();

  function put(sido: string, kind: RegionStat["fuelType"], values: number[]) {
    const d = describe(values);
    sortedPrices.set(`${sido}|${kind}`, d.sorted);
    distinctPrices.set(`${sido}|${kind}`, distinctAsc(d.sorted));
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
      const b = basisSido(r.sido, r.sigungu);
      const arr = buckets.get(b);
      if (arr) arr.push(p); else buckets.set(b, [p]);
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
    const b = basisSido(r.sido, r.sigungu);
    const arr = sumBuckets.get(b);
    if (arr) arr.push(g + d); else sumBuckets.set(b, [g + d]);
  }
  for (const [sido, values] of sumBuckets) put(sido, "sum", values);

  // ── 보정 모집단 ─────────────────────────────────────────────────────
  //
  // 선정 때 후보에서 빠졌던 것으로 보이는 주유소를 뺀 분포다. 선정이 그 잣대로
  // 이뤄졌으니 견줄 때도 같은 잣대라야 앞뒤가 맞는다. 실제로는 전국 수십 곳
  // 규모라 순위가 몇 칸 움직이는 정도다 — baseline.ts 의 역산 설명 참고.
  const adjDistinct = new Map<string, number[]>();
  {
    const buckets = new Map<string, number[]>();
    for (const r of raw.rows) {
      if (excluded.has(r.stationId)) continue;
      const g = r.gasoline, d = r.diesel;
      if (g == null || g <= 0 || d == null || d <= 0) continue;
      const b = basisSido(r.sido, r.sigungu);
      const arr = buckets.get(b);
      if (arr) arr.push(g + d); else buckets.set(b, [g + d]);
    }
    for (const [sido, values] of buckets) {
      adjDistinct.set(sido, distinctAsc(values.sort((a, b) => a - b)));
    }
  }

  /** 오늘 그 시·도의 시장 중앙값. 이탈률의 M1 이다. */
  const marketNow = new Map<string, number>();
  for (const [sido, values] of sumBuckets) marketNow.set(sido, median(values));

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

    // 견주는 모집단 키. 통합시는 선정 때와 같이 옛 광주·전남으로 갈린다.
    const basis = basisSido(effSido, effSigungu);

    const prices = {} as Record<FuelType, number | null>;
    for (const fuel of FUEL_TYPES) prices[fuel] = row?.[fuel] ?? null;

    const sum =
      prices.gasoline != null && prices.diesel != null ? prices.gasoline + prices.diesel : null;

    /**
     * 한 기준의 성적을 낸다.
     *
     * 세 기준(합산/휘발유/경유)이 순위·계수·신호등을 똑같은 방식으로 구한다.
     * 다른 것은 어느 분포에서 보느냐뿐이라 한 함수로 묶는다.
     */
    function metricFor(kind: ViewMode, value: number | null): FuelMetric {
      const statKey = kind === "sum" ? "sum" : kind;
      const stat = stats.get(`${basis}|${statKey}`);
      const sorted = sortedPrices.get(`${basis}|${statKey}`) ?? [];
      const distinct = distinctPrices.get(`${basis}|${statKey}`) ?? [];
      const n = stat?.n ?? 0;

      const rank = value != null && distinct.length > 0 ? rankOf(value, distinct) : null;
      const regionMin = sorted.length > 0 ? sorted[0] : null;
      const idx = coefficientOf(value, greenBaseOf(distinct, greenRank));

      return {
        price: value,
        regionRank: rank,
        regionN: n,
        regionMin,
        regionMean: stat?.mean ?? null,
        greenBase: idx?.regionBase ?? null,
        coefficient: idx?.coefficient ?? null,
        gapFromMin: value != null && regionMin != null ? value - regionMin : null,
        isRegionLowest: value != null && regionMin != null && value === regionMin,
        signal: toSignal(rank, greenRank, th.rankYellowFactor, n),
      };
    }

    const metrics = {} as Record<ViewMode, FuelMetric>;
    for (const mode of VIEW_MODES) {
      metrics[mode] = metricFor(mode, mode === "sum" ? sum : prices[mode]);
    }
    const m = metrics.sum;

    /**
     * 보정 판정.
     *
     * 순위는 제외 추정분을 뺀 모집단에서 다시 매기고, 이탈률은 선정 기준기간의
     * 자기 가격에 그 사이 시장이 움직인 비율을 곱한 값과 견준다. 둘 다 통과해야
     * 초록이다 — adjust.ts 참고.
     */
    const adjusted: AdjustedMetric | null = (() => {
      const b = stationId ? baseline?.stations[stationId] : undefined;
      if (!baseline || !b || sum == null) return null;

      const m0 = baseline.market[b.window]?.[basis];
      const m1 = marketNow.get(basis);
      if (!m0 || !m1) return null;

      const expected = b.base * (m1 / m0);
      const drift = (sum - expected) / expected;

      const distinct = adjDistinct.get(basis) ?? [];
      const rank = distinct.length > 0 ? rankOf(sum, distinct) : null;
      const greenBase = greenBaseOf(distinct, greenRank);
      const idx = coefficientOf(sum, greenBase);
      const rankSignal = toSignal(rank, greenRank, th.rankYellowFactor, distinct.length);
      const dSignal = driftSignalOf(drift, driftGreen, driftYellow);

      // 무엇을 묻고 싶은지에 따라 묶는 방식이 다르다 — signal.ts 의 설명 참고.
      const combined =
        combine === "drift" ? dSignal :
        combine === "rank" ? rankSignal :
        worseOf(rankSignal, dSignal);

      return {
        window: b.window,
        windowConfirmed: CONFIRMED_ROUNDS.includes(b.round),
        base: b.base,
        expected: Math.round(expected * 100) / 100,
        drift: Math.round(drift * 1e6) / 1e6,
        driftSignal: dSignal,
        rank,
        regionN: distinct.length,
        greenBase,
        coefficient: idx?.coefficient ?? null,
        rankSignal,
        signal: combined,
      };
    })();

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
      rounds: roundsOf(g),
      // 시계열을 얹은 뒤 아래에서 채운다
      overRegion: null,
      prices,
      metrics,

      // 합산 기준을 펼쳐 둔 값
      sum,
      priceIndex: m.coefficient != null && m.greenBase != null && sum != null
        ? { sum, regionBase: m.greenBase, coefficient: m.coefficient }
        : null,
      regionMinSum: m.regionMin,
      regionMeanSum: m.regionMean,
      gapFromMin: m.gapFromMin,
      regionRank: m.regionRank,
      regionN: m.regionN,
      greenRank,
      isRegionLowest: m.isRegionLowest,
      signal: m.signal,
      // 시계열을 얹은 뒤 아래에서 채운다
      dataGapDays: 0,
      compliance: { from: COMPLIANCE_FROM, to: COMPLIANCE_FROM, greenDays: 0, yellowDays: 0, redDays: 0, missingDays: 0 },
      adjusted,
    });
  }

  // ── 시계열 ──────────────────────────────────────────────────────────
  //
  // 판정보다 먼저 얹는다. 아래에서 "여태 한 번이라도 가격이 빈 적이 있는가" 를
  // 세려면 오늘치까지 들어간 시계열이 필요하다.
  const historyPath = path.join(DATA, "history.json");
  const history: History = existsSync(historyPath)
    ? JSON.parse(readFileSync(historyPath, "utf8")) : emptyHistory();

  const ids = new Set<string>();
  for (const s of signals) if (s.stationId) ids.add(s.stationId);

  mergeDay(history, date,
    sampleDay(raw.rows, ids, (sido) => greenRankWith(sido, th), th.rankYellowFactor));
  // 날짜축을 맞춘 뒤라야 자리를 찾는다.
  mergeRegionMean(history, date, regionMeanOf(raw.rows));
  const droppedSeries = pruneTo(history, ids);
  history.generatedAt = new Date().toISOString();

  // 시각 필드만 다른 재작성은 걸러 낸다 — stable-write.ts 참고.
  let rewritten = 0;
  if (writeJsonIfChanged(historyPath, history, TIMESTAMP)) rewritten++;
  if (writeJsonIfChanged(path.join(OUT_DIR, "history.json"), history, TIMESTAMP)) rewritten++;

  // ── 가격을 믿기 어려운 곳 ───────────────────────────────────────────
  //
  // 둘로 나눈다. 성격이 달라 한 칸에 묶으면 무엇을 확인해야 하는지 흐려진다.
  //
  //   unknown  오늘 가격이 없어 아예 판정을 못 한 곳 → 지금 확인할 일
  //   stale    오늘은 가격이 있으나 과거에 거른 이력이 있는 곳 → 신고 이력을 볼 일
  //
  // 하루치만 보고 판정하면 "어제는 1위, 오늘은 미상" 처럼 오락가락한다. 신고를
  // 거른 이력이 있으면 그 값을 믿고 순위를 매기기 어렵다는 뜻이라, 판정에서
  // 빼되 오늘 값이 아예 없는 곳과는 구분해 둔다.
  let gapCount = 0;
  let staleCount = 0;
  for (const sig of signals) {
    /**
     * 신고를 거른 날 수 — **기본 구간(8월 1일~) 안에서만** 센다.
     *
     * 시계열이 3월까지 늘어나면서 전 구간을 훑었더니 과거 미신고가 20곳에서
     * 54곳으로 늘었다. 다섯 달 전 하루를 걸렀다는 이유로 오늘 판정을 못 하는
     * 것은 뜻이 없다 — 이 표시는 '지금 이 가격을 믿고 순위를 매겨도 되는가' 를
     * 묻는 것이라 최근 이력이라야 답이 된다.
     *
     * 그래프는 이것과 무관하게 3월치부터 다 그린다. 판정을 접는 범위와 보여줄
     * 범위는 다른 이야기다.
     */
    const series = sig.stationId ? history.stations[sig.stationId] : undefined;
    let gaps = 0;
    if (series) {
      for (let i = 0; i < history.dates.length; i++) {
        if (history.dates[i] < COMPLIANCE_FROM) continue;
        const g = series.g[i];
        const d = series.d[i];
        if (g == null || d == null || g === 0 || d === 0) gaps++;
      }
    } else {
      // 시계열조차 없으면 전부 결측으로 본다
      gaps = history.dates.filter((x) => x >= COMPLIANCE_FROM).length;
    }

    sig.dataGapDays = gaps;
    if (sig.stationId) sig.compliance = complianceOf(history, sig.stationId, COMPLIANCE_FROM);
    if (gaps === 0) continue;

    // 오늘 값이 있으면 stale, 없으면 unknown.
    const hasToday = sig.prices.gasoline != null && sig.prices.diesel != null;
    const mark: "stale" | "unknown" = hasToday ? "stale" : "unknown";
    if (hasToday) staleCount++; else gapCount++;

    sig.signal = mark;
    for (const mode of VIEW_MODES) sig.metrics[mode].signal = mark;
    // 값이 없어서 못 재는 것은 판정 방식과 무관하다. 보정 쪽도 같이 덮는다.
    if (sig.adjusted) sig.adjusted.signal = mark;
  }

  // ── 선정 이후 지역 평균 초과 ────────────────────────────────────────
  //
  // 신호등은 **오늘** 그 시·도에서 몇 위냐를 묻는다. 이건 다른 질문이다 —
  // **뽑힌 뒤로 줄곧** 그 시·도 평균보다 비싸게 팔았는가. 오늘 하루 싸게
  // 판다고 지난 다섯 달이 지워지지 않으므로 따로 센다.
  //
  // 기준일은 그 주유소의 **최초 선정 공시일**이다. 여러 차수에 걸쳐 다시 뽑힌
  // 곳도 착한주유소였던 기간은 처음부터 이어진다.
  //
  // 하루라도 넘기면 대상이다 — types.ts 의 CANCEL_MIN_OVER_DAYS.
  let cancelCount = 0;
  for (const sig of signals) {
    if (!sig.stationId || !sig.rounds.length) continue;
    const since = ROUND_ANNOUNCED[sig.rounds[0]];
    if (!since) continue;
    const basis = basisSido(sig.sido, sig.sigungu);
    sig.overRegion = overRegionOf(overDaysOf(history, sig.stationId, basis, since), since);
    if (!sig.overRegion?.cancel) continue;

    // 취소 대상은 다른 무엇보다 앞선다. 오늘 순위가 어떻든 선정 자체를 다시
    // 볼 일이기 때문이다.
    cancelCount++;
    sig.signal = "cancel";
    for (const mode of VIEW_MODES) sig.metrics[mode].signal = "cancel";
    if (sig.adjusted) sig.adjusted.signal = "cancel";
  }

  // ── 요약 ────────────────────────────────────────────────────────────
  const tally = (pick: (s: StationSignal) => SignalColor) => {
    const out = emptyCounts();
    for (const s of signals) out[pick(s)]++;
    return out;
  };

  const counts = tally((s) => s.signal);
  // 기준선이 없어 보정 값을 못 낸 곳은 판정 불가로 센다. 현재 방식의 색을
  // 빌려 오면 두 방식의 개수를 나란히 놓고 견줄 수가 없다.
  const adjustedCounts = tally(adjustedSignalOf);

  // 시·도 통계는 전부 실어도 50건이 안 된다.
  const regions: RegionStat[] = [...stats.values()];

  // ── 순위별 커트라인 ─────────────────────────────────────────────────
  //
  // 관리 화면에서 기준 순위를 바꾸면 계수의 분모가 함께 바뀐다. 그런데 그 분모는
  // 전국 분포에서 뽑는 값이므로 시·도별 서로 다른 가격을 전부 싣는다.
  // 표시용 순위표 행 수와 독립적으로 전체 설정 범위의 분모를 계산한다.
  const cutoffs: BoardData["cutoffs"] = {};
  for (const [key, distinct] of distinctPrices) {
    const [sido, kind] = key.split("|");
    if (!VIEW_MODES.includes(kind as ViewMode)) continue;
    (cutoffs[sido] ??= {})[kind as ViewMode] = cutoffsOf(distinct);
  }
  const adjustedCutoffs: BoardData["adjustedCutoffs"] = {};
  for (const [sido, distinct] of adjDistinct) adjustedCutoffs[sido] = cutoffsOf(distinct);

  const board: BoardData = {
    date,
    generatedAt: new Date().toISOString(),
    stations: signals,
    regions,
    cutoffs,
    cutoffsComplete: true,
    adjustedCutoffs,
    summary: { total: good.length, matched: matchedCount, counts, adjustedCounts },
    judgeMode: th.judgeMode ?? "rank",
    baseline: baseline
      ? {
          windows: baseline.windows,
          confirmedRounds: CONFIRMED_ROUNDS,
          excludedCount: baseline.excluded.length,
          combine,
          driftGreen,
          driftYellow,
        }
      : null,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  if (writeJsonIfChanged(path.join(OUT_DIR, `board-${date}.json`), board, TIMESTAMP)) rewritten++;
  if (writeJsonIfChanged(path.join(OUT_DIR, "latest.json"), board, TIMESTAMP)) rewritten++;

  // 계수 검증용 순위표. 화면에 전국 1.1만 건을 통째로 내려보낼 수는 없으니
  // 시·도별 상위 K건만 뽑아 둔다. 과거 날짜는 `npm run ranks` 가 원본에서 만든다.
  if (writeJsonIfChanged(
    path.join(OUT_DIR, `rank-${date}.json`),
    buildRanks(raw.rows, ids, th, date),
    TIMESTAMP,
  )) rewritten++;

  // 보관 기간을 넘긴 스냅샷 정리
  const all = readdirSync(OUT_DIR)
    .filter((f) => /^board-\d{8}\.json$/.test(f))
    .map((f) => f.slice(6, 14))
    .sort()
    .reverse();

  const stale = all.slice(KEEP_DAYS);
  for (const d of stale) rmSync(path.join(OUT_DIR, `board-${d}.json`), { force: true });
  if (stale.length) console.log(`[aggregate] 오래된 스냅샷 ${stale.length}건 정리 (보관 ${KEEP_DAYS}일)`);

  /**
   * 순위표도 같은 기간만 남긴다.
   *
   * 예전에는 board 날짜 목록으로 지웠는데, `npm run ranks` 는 보관 원본 전체를
   * 대상으로 도는 반면 board 는 집계가 돈 날만 생긴다. 그래서 순위표만 191일치가
   * 쌓여 있었다. 자기 날짜로 세야 맞다. 지운 날도 원본이 있으니
   * `npm run ranks 20260315` 로 언제든 다시 만든다.
   */
  const rankDates = readdirSync(OUT_DIR)
    .filter((f) => /^rank-\d{8}\.json$/.test(f))
    .map((f) => f.slice(5, 13))
    .sort()
    .reverse();
  const staleRanks = rankDates.slice(KEEP_DAYS);
  for (const d of staleRanks) rmSync(path.join(OUT_DIR, `rank-${d}.json`), { force: true });
  if (staleRanks.length) {
    console.log(`[aggregate] 오래된 순위표 ${staleRanks.length}건 정리 (보관 ${KEEP_DAYS}일)`);
  }

  const available = all.slice(0, KEEP_DAYS);
  // 순위표는 파일이 실제로 있는 날짜만 싣는다. 화면의 날짜 선택이 이 목록을 쓴다.
  const ranks = readdirSync(OUT_DIR)
    .filter((f) => /^rank-\d{8}\.json$/.test(f))
    .map((f) => f.slice(5, 13))
    .sort()
    .reverse();
  if (writeJsonIfChanged(path.join(OUT_DIR, "index.json"), { dates: available, ranks })) rewritten++;


  // ── 콘솔 요약 ───────────────────────────────────────────────────────
  const withIndex = signals.filter((s) => s.priceIndex).length;
  console.log(`[aggregate] 완료 — 기준일 ${date}`);
  console.log(
    rewritten === 0
      ? "  산출물 그대로 — 값이 하나도 바뀌지 않아 다시 쓰지 않았습니다."
      : `  산출물 ${rewritten}건 갱신`,
  );
  console.log(`  매칭된 착한주유소: ${matchedCount}/${good.length}`);
  console.log(`  신호등: 상위권 ${counts.green} / 근접 ${counts.yellow} / 미달 ${counts.red} / 미상 ${counts.unknown}`);
  console.log(`  합산 계수 산출: ${withIndex}곳 (1.000 = 초록불 커트라인)`);
  console.log(`  가격정보 없음: ${gapCount}곳 (오늘 가격 없음) / 과거 미신고: ${staleCount}곳`);
  console.log(`  선정 취소 대상: ${cancelCount}곳 (선정 이후 시·도 평균을 한 번이라도 넘김)`);
  console.log(`  적용 기준: 서울·경기 ${th.rankGreenMetro}위 / 그 외 ${th.rankGreenDefault}위 이내 상위권, 근접은 ${th.rankYellowFactor}배까지`);
  console.log(`\n  client/public/data/latest.json`);
}

main();
