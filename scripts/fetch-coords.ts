/**
 * 보조 — 착한주유소 좌표 수집
 *
 *   data/station-mapping.json → Opinet detailById.do → data/station-coords.json
 *
 * 지도에 개별 주유소 핀을 찍고 싶을 때만 필요하다. 시·군·구 단위 색칠 현황판은
 * 좌표 없이도 동작하므로 필수는 아니다.
 *
 * Opinet이 주는 GIS_X/Y는 KATEC 좌표라 WGS84로 변환해 저장한다.
 * 이미 받아둔 좌표는 건너뛰므로 여러 번 돌려도 안전하다.
 *
 * 필요: OPINET_API_KEY 환경변수
 * 실행: npx tsx scripts/fetch-coords.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchStationDetails } from "../src/lib/opinet/api.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

async function main() {
  if (!process.env.OPINET_API_KEY) {
    console.error("OPINET_API_KEY 환경변수가 필요합니다.");
    console.error("  Windows PowerShell:  $env:OPINET_API_KEY=\"발급받은키\"");
    console.error("  bash:                export OPINET_API_KEY=발급받은키");
    process.exit(1);
  }

  const mappingPath = path.join(DATA, "station-mapping.json");
  if (!existsSync(mappingPath)) {
    console.error("data/station-mapping.json 이 없습니다. 먼저 `npm run match`.");
    process.exit(1);
  }

  const mapping: Record<string, { stationId: string }> = JSON.parse(readFileSync(mappingPath, "utf8"));
  const coordsPath = path.join(DATA, "station-coords.json");
  const coords: Record<string, { lat: number; lng: number }> = existsSync(coordsPath)
    ? JSON.parse(readFileSync(coordsPath, "utf8")) : {};

  const wanted = [...new Set(Object.values(mapping).map((m) => m.stationId))];
  const todo = wanted.filter((id) => !coords[id]);

  console.log(`[coords] 대상 ${wanted.length}곳, 이미 보유 ${wanted.length - todo.length}곳, 조회 ${todo.length}곳`);
  if (todo.length === 0) { console.log("[coords] 새로 받을 것이 없습니다."); return; }

  const { details, failures, samples } = await fetchStationDetails(todo, 4, (done, total) => {
    if (done % 50 === 0 || done === total) console.log(`  ${done}/${total}`);
  });

  let ok = 0;
  let noCoord = 0;
  for (const [id, d] of details) {
    if (d.coord) { coords[id] = d.coord; ok++; }
    else noCoord++;
  }

  writeFileSync(coordsPath, JSON.stringify(coords, null, 0), "utf8");

  console.log(`[coords] 완료 — 신규 ${ok}곳, 좌표 없음/변환 실패 ${noCoord}곳, 조회 실패 ${todo.length - details.size}곳`);
  console.log(`  data/station-coords.json (누적 ${Object.keys(coords).length}곳)`);

  // ── 실패했다면 왜 실패했는지 밝힌다 ──────────────────────────────────
  //
  // 오피넷은 인증키가 틀려도 HTTP 200 에 빈 배열을 돌려준다. 그래서 사유를
  // 구분해 두지 않으면 "그냥 안 된다"밖에 알 수 없다.
  if (failures.size > 0) {
    console.log("\n[coords] 실패 사유:");
    for (const [kind, n] of failures) console.log(`  ${kind.padEnd(8)} ${n}건`);
    for (const s of samples) {
      console.log(`  예) ${s.id}: ${JSON.stringify(s.failure)}`);
    }
    if (failures.get("empty") === todo.length) {
      console.log("\n  전건이 빈 응답입니다. 인증키 문제일 가능성이 큽니다.");
      console.log("  · 오피넷에서 발급 승인이 끝났는지 (신청 직후에는 바로 안 될 수 있음)");
      console.log("  · 주유소 상세(detailById)가 발급받은 등급에 포함되는지");
      console.log("  확인해 주세요. https://www.opinet.co.kr/user/custapi/custApiInfo.do");
    }
  }
}

main().catch((e) => { console.error("[coords] 예외:", e); process.exit(1); });
