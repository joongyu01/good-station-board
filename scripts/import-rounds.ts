/**
 * 선정 명단 원본(xlsx) → data/station-rounds.json
 *
 *   npm run rounds -- "C:/…/260901_착한주유소_리스트(472개).xlsx"
 *
 * ## 왜 필요한가
 *
 * `stations.csv` 의 `선정차수` 열에는 **최초** 선정차수만 있다. 그런데 명단
 * 원본을 보면 한 주유소가 여러 차수에 걸쳐 다시 뽑힌다 — 172곳이 그렇고, 다섯
 * 번 뽑힌 곳도 있다(`1차,4차,5차,6차,7차`).
 *
 * 기준선은 **마지막** 선정차수를 따라야 한다. 최초 차수로 잡으면 9차(8월
 * 기준)에 다시 뽑힌 곳을 1차 기준으로 재게 된다. 마지막 차수로 세면 9차가
 * 37곳이 아니라 93곳이다.
 *
 * ## 원본에서 가져오는 것
 *
 *   rounds   그 주유소가 뽑힌 모든 차수 (O~W 열의 차수 플래그)
 *   removed  제외요청으로 명단에서 빠진 곳 — 에너지시장감시단 57 · 사업장 8
 *   optOut   개인정보 제공에 동의하지 않아 인센티브에서 빠진 곳
 *
 * ## 이 파일이 확인해 주는 것
 *
 * 차수 × 시·도로 세어 보면 거의 모든 칸이 정확히 5, 서울·경기만 10이다.
 * 초과는 6~8뿐이고 전부 동점으로 설명된다. 판정에 쓰는 상위 N위 기준이 실제
 * 선정 규칙과 같다는 뜻이다.
 *
 * 원본 xlsx 는 저장소에 두지 않는다. 명단이 새로 오면 이 스크립트를 한 번 돌려
 * 결과 JSON 만 커밋한다 — 좌표를 국내에서 한 번 받아 커밋하는 것과 같다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { writeJsonIfChanged } from "../src/lib/stable-write.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

const ROUNDS = ["1차", "2차", "3차", "4차", "5차", "6차", "7차", "8차", "9차"];

/** 헤더가 놓인 행. 위쪽 열두 행은 차수별 집계표다. */
const HEADER_ROW = 17;

/** 열 위치. 원본 서식이 바뀌면 여기만 고친다. */
const COL = {
  firstRound: 0, stationId: 1, region: 2, name: 3,
  removedByWatch: 9, removedBySite: 10, removedAt: 11, privacyOptOut: 12,
  /** O~W — 1차~9차 선정 플래그 */
  roundFlagStart: 14,
};

export interface StationRounds {
  generatedAt: string;
  source: string;
  /** 주유소코드 → 뽑힌 차수들 */
  stations: Record<string, { first: string; last: string; rounds: string[] }>;
  /** 제외요청으로 명단에서 빠진 곳 */
  removed: Record<string, { by: string; date: string | null }>;
  /** 개인정보 제공 미동의 */
  optOut: string[];
}

/** 엑셀 날짜 일련번호 → YYYY-MM-DD. 1900 체계 기준일은 1899-12-30 이다. */
function excelDate(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const ms = Date.UTC(1899, 11, 30) + v * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function main() {
  const src = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!src) {
    console.error("명단 원본 경로가 필요합니다 — npm run rounds -- \"…/착한주유소_리스트.xlsx\"");
    process.exit(1);
  }

  const wb = XLSX.read(readFileSync(src), { type: "buffer" });
  const sheet = wb.Sheets["리스트"];
  if (!sheet) {
    console.error(`'리스트' 시트를 찾지 못했습니다. 있는 시트: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });

  const out: StationRounds = {
    generatedAt: new Date().toISOString(),
    source: path.basename(src),
    stations: {},
    removed: {},
    optOut: [],
  };

  const perRoundSido = new Map<string, Map<string, number>>();

  for (let i = HEADER_ROW + 1; i < rows.length; i++) {
    const r = rows[i];
    const id = r?.[COL.stationId];
    if (typeof id !== "string" || !/^A\d+$/.test(id)) continue;

    // 차수 플래그. 값은 그 차수 이름이 그대로 들어 있다.
    const rounds: string[] = [];
    for (let k = 0; k < ROUNDS.length; k++) {
      if (r[COL.roundFlagStart + k] != null) rounds.push(ROUNDS[k]);
    }
    // 플래그가 비어 있으면 최초 차수 하나만 있는 것으로 본다.
    const first = String(r[COL.firstRound] ?? "").trim();
    if (rounds.length === 0 && first) rounds.push(first);
    if (rounds.length === 0) continue;

    out.stations[id] = { first: rounds[0], last: rounds[rounds.length - 1], rounds };

    const by = r[COL.removedByWatch] != null ? "에너지시장감시단"
      : r[COL.removedBySite] != null ? "사업장" : null;
    if (by) out.removed[id] = { by, date: excelDate(r[COL.removedAt]) };
    if (r[COL.privacyOptOut] != null) out.optOut.push(id);

    const sido = String(r[COL.region] ?? "").split(" ")[0];
    for (const rd of rounds) {
      if (!perRoundSido.has(rd)) perRoundSido.set(rd, new Map());
      const m = perRoundSido.get(rd)!;
      m.set(sido, (m.get(sido) ?? 0) + 1);
    }
  }

  out.optOut.sort();

  // 선정 규칙 확인 — 서울·경기 10, 그 밖 5. 넘는 칸은 동점으로 본다.
  let over = 0;
  for (const [, m] of perRoundSido) {
    for (const [sido, n] of m) {
      if (n > (sido === "서울" || sido === "경기" ? 10 : 5)) over++;
    }
  }

  const ids = Object.keys(out.stations);
  const multi = ids.filter((k) => out.stations[k].rounds.length > 1).length;
  const lastTally = new Map<string, number>();
  for (const k of ids) {
    const l = out.stations[k].last;
    lastTally.set(l, (lastTally.get(l) ?? 0) + 1);
  }

  const changed = writeJsonIfChanged(path.join(DATA, "station-rounds.json"), out, ["generatedAt"]);

  console.log(`[rounds] ${out.source}`);
  console.log(`  주유소 ${ids.length}곳 · 여러 차수에 걸쳐 뽑힌 곳 ${multi}`);
  console.log(`  제외요청 ${Object.keys(out.removed).length} · 개인정보 미동의 ${out.optOut.length}`);
  console.log(`  마지막 선정차수: ${ROUNDS.map((r) => `${r} ${lastTally.get(r) ?? 0}`).join(" · ")}`);
  console.log(`  차수×시·도 한도(서울·경기 10 / 그 외 5) 초과 칸 ${over}개 — 동점 구간`);
  console.log(`  data/station-rounds.json${changed ? "" : "  그대로 (내용이 같아 다시 쓰지 않음)"}`);
}

main();
