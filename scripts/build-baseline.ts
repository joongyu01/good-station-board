/**
 * 보정 판정의 기준선 — 선정 시점의 가격과 그때 시장
 *
 *   data/raw/*.json.gz  →  data/baseline.json
 *
 * ## 왜 필요한가
 *
 * 명단 472곳은 한 번에 뽑힌 것이 아니라 **아홉 차수**에 걸쳐 뽑혔고, 차수마다
 * 선정 기준기간이 다르다. 그런데 현황판은 1차부터 9차까지 전부 '오늘의
 * 상위 N위' 라는 한 잣대로 잰다. 선정된 지 오래된 차수가 뒤로 밀리는 것은
 * 그 주유소 사정이 아니라 잣대가 묻는 질문이 달라서다.
 *
 * 기준기간은 보관 원본에서 추산했다. 그 차수에 뽑힌 곳들이 자기 기간에 시·도
 * 상위 N위였던 비율이다.
 *
 *   차수    1차   2차   3차   4차   5차   6차   7차   8차   9차
 *   충족률   2%    5%   13%   75%   73%   77%   84%   80%   81%
 *
 * 4차부터는 그 기간이 곧 선정 기준기간이다. 1~3차는 기간을 옳게 짚어도 값이
 * 낮은데, 그때는 가격 순위로 뽑지 않았기 때문이다 — 근거는 ROUNDS.md §4,
 * 재현은 `npm run rounds:estimate`.
 *
 * ## 무엇을 만드나
 *
 *   base   그 주유소의 기준기간 일별 합계(휘발유+경유) 평균
 *   market 같은 기간 그 시·도 **전체** 주유소 합계의 중앙값
 *   excluded  선정 때 빠진 것으로 보이는 주유소
 *
 * 시장 기준을 평균이 아니라 **중앙값**으로 잡는다. 상위 N위 커트라인은 극단
 * 순서통계량이라 싼 쪽 꼬리 몇 곳에 통째로 흔들린다. 중앙값은 꿈쩍하지 않는다.
 *
 * ## excluded 를 역산하는 근거
 *
 * 선정은 '그 시·도에서 상위 N위' 인데, 뽑히지 않은 주유소 중에 뽑힌 곳보다
 * 싼 곳이 있다면 그 곳은 애초에 후보가 아니었다는 뜻이다. 그래서 기준기간을
 * 아는 차수(8차·9차)를 놓고, **그 차수 최하위보다 싼데 명단에 없는 주유소**를
 * 후보에서 빠졌던 곳으로 본다.
 *
 * 실제로 세어 보면 전국 스무 곳 남짓, 모집단의 0.2% 다. 순위를 몇 칸 움직일
 * 뿐이라 이것만으로 판정이 뒤집히지는 않는다. 그래도 빼고 세는 편이 선정 때와
 * 같은 잣대다.
 *
 * 실행:
 *   npm run baseline
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { basisSido } from "../src/lib/region.ts";
import { readRaw } from "../src/lib/raw.ts";
import { writeJsonIfChanged } from "../src/lib/stable-write.ts";
import { DEFAULT_ROUND_WINDOWS, median, periodDays, type Baseline } from "../src/lib/adjust.ts";
import type { GoodStation } from "../src/lib/types.ts";
import type { EnrichedRow } from "./collect.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const RAW_DIR = path.join(DATA, "raw");

/** 한 기준기간 원본에서 주유소별 평균 합계와 시·도 중앙값을 낸다. */
function readWindow(period: string) {
  const perStation = new Map<string, { sido: string; sum: number; days: number }>();
  const perSido = new Map<string, number[]>();
  let files = 0;

  for (const date of periodDays(period)) {
    const raw = readRaw<{ rows: EnrichedRow[] }>(RAW_DIR, date);
    if (!raw) continue;
    files++;

    for (const r of raw.rows) {
      // 합계는 두 유종을 모두 파는 곳만 갖는다. 판정 모집단과 같은 잣대다.
      if (r.gasoline == null || r.gasoline <= 0) continue;
      if (r.diesel == null || r.diesel <= 0) continue;
      const v = r.gasoline + r.diesel;

      // 견주는 모집단 키. 통합시는 선정 때와 같이 옛 광주·전남으로 갈린다.
      const basis = basisSido(r.sido, r.sigungu);

      let a = perStation.get(r.stationId);
      if (!a) perStation.set(r.stationId, (a = { sido: basis, sum: 0, days: 0 }));
      a.sum += v;
      a.days++;

      const arr = perSido.get(basis);
      if (arr) arr.push(v); else perSido.set(basis, [v]);
    }
  }

  return { perStation, perSido, files };
}

/**
 * 한 차수를 놓고, 그 차수 최하위보다 싼데 명단에 없는 주유소를 모은다.
 *
 * 순위가 아니라 값으로 견준다. 조밀 순위에서 동점이면 같은 등수라, 최하위와
 * 값이 **같은** 곳은 뽑힐 수도 있었던 자리다. 그런 곳까지 제외로 몰면 실제보다
 * 많이 걷힌다. 그래서 '더 싼' 곳만 센다.
 */
function inferExcluded(
  window: ReturnType<typeof readWindow>,
  roundIds: Set<string>,
  goodIds: Set<string>,
): string[] {
  const worstBySido = new Map<string, number>();
  for (const id of roundIds) {
    const a = window.perStation.get(id);
    if (!a || a.days === 0) continue;
    const avg = a.sum / a.days;
    const cur = worstBySido.get(a.sido);
    if (cur == null || avg > cur) worstBySido.set(a.sido, avg);
  }

  const out: string[] = [];
  for (const [id, a] of window.perStation) {
    if (a.days === 0 || goodIds.has(id)) continue;
    const worst = worstBySido.get(a.sido);
    if (worst == null) continue;
    if (a.sum / a.days < worst) out.push(id);
  }
  return out;
}

function main() {
  const good: GoodStation[] = JSON.parse(
    readFileSync(path.join(DATA, "good-stations.json"), "utf8"),
  );
  const goodIds = new Set(good.map((g) => g.stationId).filter((v): v is string => !!v));

  /**
   * 명단 원본에서 들여온 차수 정보. 없으면 stations.csv 의 최초 차수만 쓴다.
   *
   * 기준선은 **마지막** 선정차수를 따라야 한다. 한 주유소가 여러 차수에 걸쳐
   * 다시 뽑히기 때문이다(172곳). 최초 차수로 잡으면 9차에 다시 뽑힌 곳을 1차
   * 기준으로 재게 된다 — 마지막 차수로 세면 9차가 37곳이 아니라 93곳이다.
   */
  const roundsPath = path.join(DATA, "station-rounds.json");
  const src: {
    stations: Record<string, { first: string; last: string; rounds: string[] }>;
    removed: Record<string, { by: string; date: string | null }>;
  } | null = existsSync(roundsPath) ? JSON.parse(readFileSync(roundsPath, "utf8")) : null;
  if (!src) {
    console.warn("[baseline] data/station-rounds.json 이 없습니다. 최초 선정차수로 갈음합니다 — npm run rounds");
  }

  /** 그 주유소의 기준이 될 차수. 다시 뽑힌 곳은 마지막 차수다. */
  const roundOf = (g: GoodStation): string | null =>
    (g.stationId ? src?.stations[g.stationId]?.last : null) ?? g.round;

  // 차수별 기준기간. 관리 화면에서 고친 값이 있으면 그것을 쓴다.
  const cfgPath = path.join(DATA, "round-windows.json");
  const windows: Record<string, string> = existsSync(cfgPath)
    ? { ...DEFAULT_ROUND_WINDOWS, ...JSON.parse(readFileSync(cfgPath, "utf8")) }
    : { ...DEFAULT_ROUND_WINDOWS };

  const needed = [...new Set(Object.values(windows))].sort();
  const loaded = new Map<string, ReturnType<typeof readWindow>>();
  for (const w of needed) {
    const r = readWindow(w);
    if (r.files === 0) {
      console.warn(`[baseline] ${w} 원본이 없습니다. 이 기간을 쓰는 차수는 기준선이 비게 됩니다.`);
      continue;
    }
    loaded.set(w, r);
    console.log(`[baseline] ${w} — ${r.files}/${periodDays(w).length}일 · 주유소 ${r.perStation.size}곳`);
  }

  // ── 시장 중앙값 ─────────────────────────────────────────────────────
  const market: Baseline["market"] = {};
  for (const [w, r] of loaded) {
    market[w] = {};
    for (const [sido, values] of r.perSido) market[w][sido] = Math.round(median(values) * 100) / 100;
  }

  // ── 주유소별 기준가 ─────────────────────────────────────────────────
  const stations: Baseline["stations"] = {};
  let missing = 0;
  for (const g of good) {
    if (!g.stationId) continue;
    const round = roundOf(g);
    if (!round) { missing++; continue; }
    const w = windows[round];
    const src = w ? loaded.get(w) : undefined;
    const a = src?.perStation.get(g.stationId);
    if (!w || !a || a.days === 0) { missing++; continue; }
    stations[g.stationId] = {
      round,
      window: w,
      base: Math.round((a.sum / a.days) * 100) / 100,
      days: a.days,
    };
  }

  // ── 선정 때 빠진 것으로 보이는 주유소 ───────────────────────────────
  //
  // 기준기간을 데이터로 확인한 차수만 쓴다. 기간을 모르는 차수로 역산하면
  // 엉뚱한 시점의 가격을 놓고 세는 것이라 아무 뜻이 없다.
  const excluded = new Set<string>();
  for (const round of ["8차", "9차"]) {
    const w = windows[round];
    const src = w ? loaded.get(w) : undefined;
    if (!src) continue;
    const ids = new Set(
      good.filter((g) => roundOf(g) === round && g.stationId).map((g) => g.stationId!),
    );
    if (!ids.size) continue;
    const got = inferExcluded(src, ids, goodIds);
    for (const id of got) excluded.add(id);
    console.log(`[baseline] ${round}(${w}) 역산 — 제외 추정 ${got.length}곳`);
  }

  // 제외요청으로 명단에서 빠진 곳도 오늘의 후보가 아니다. 역산분과 합친다.
  //
  // 둘은 성격이 다르다. 역산은 '애초에 후보가 아니었던 곳', 제외요청은 '뽑혔다가
  // 빠진 곳' 이다. 실제로 겹치는 것은 다섯 곳뿐이고, 그 다섯은 모두 8·9차 선정
  // **전에** 빠져서 그때 이미 후보가 아니었다.
  const inferredCount = excluded.size;
  for (const id of Object.keys(src?.removed ?? {})) excluded.add(id);

  const out: Baseline = {
    generatedAt: new Date().toISOString(),
    windows,
    market,
    stations,
    excluded: [...excluded].sort(),
  };

  const changed = writeJsonIfChanged(path.join(DATA, "baseline.json"), out, ["generatedAt"]);
  console.log(`[baseline] 완료 — 기준선 ${Object.keys(stations).length}곳` +
    (missing ? ` (기준기간 원본이 없어 빠진 곳 ${missing})` : ""));
  console.log(`  모집단에서 뺀 곳 ${out.excluded.length} — 역산 ${inferredCount} · 제외요청 ${Object.keys(src?.removed ?? {}).length} (겹침 포함)`);
  console.log(`  data/baseline.json${changed ? "" : "  그대로 (내용이 같아 다시 쓰지 않음)"}`);
}

main();
