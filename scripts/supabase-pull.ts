/**
 * 0단계 — Supabase 에서 명단·설정·키를 내려받는다.
 *
 *   gs_station  → data/good-stations.json      (adress.csv 를 대체)
 *               → data/manual-mapping.json     (station_id 가 지정된 건)
 *               → data/station-coords.json     (수기 보정 좌표, src=manual)
 *   gs_config   → data/thresholds.json
 *   gs_secret   → OPINET_API_KEY 를 $GITHUB_ENV 로 (service_role 일 때만)
 *
 * 이렇게 파일로 떨어뜨리면 뒤따르는 match·aggregate 단계는 손댈 필요가 없다.
 * Supabase 가 없거나 접속이 안 되면 **아무것도 덮어쓰지 않고 그냥 넘어간다.**
 * 저장소에 커밋된 기존 파일로 파이프라인이 계속 돌아야 하기 때문이다.
 *
 * 실행:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run supabase:pull
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... GS_ACCESS_CODE=kpetro npm run supabase:pull
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeMode, fetchConfig, fetchSecret, fetchStations, mode } from "../src/lib/supa-admin.ts";
import type { GoodStation } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

async function main() {
  if (mode() === "off") {
    console.log("[pull] Supabase 미설정 — 기존 파일을 그대로 씁니다.");
    return;
  }
  console.log(`[pull] 접속 방식: ${describeMode()}`);

  // ── 명단 ────────────────────────────────────────────────────────────
  const rows = await fetchStations();
  if (rows.length === 0) {
    console.warn("[pull] 명단이 비어 있습니다. 덮어쓰지 않고 기존 파일을 유지합니다.");
    console.warn("  `npm run supabase:seed` 로 먼저 명단을 넣으세요.");
    return;
  }

  const active = rows.filter((r) => r.active);
  const stations: GoodStation[] = active.map((r) => ({
    seq: r.seq,
    name: r.name,
    address: r.address,
    sido: r.sido,
    sigungu: r.sigungu,
    sigunguDetail: r.sigungu_detail || r.sigungu,
    regionKey: r.region_key,
    stationId: null, // 매칭 단계가 채운다
  }));

  writeFileSync(
    path.join(DATA, "good-stations.json"),
    JSON.stringify(stations, null, 2),
    "utf8",
  );

  // 주유소코드가 지정된 건은 수기 매핑으로 넘긴다. 매칭 1순위가 된다.
  const manual: Record<string, string> = {};
  for (const r of active) {
    if (r.station_id) manual[String(r.seq)] = r.station_id;
  }
  writeFileSync(
    path.join(DATA, "manual-mapping.json"),
    JSON.stringify(manual, null, 2),
    "utf8",
  );

  // 수기 보정 좌표. 기존 자동 수집분은 지우지 않고 위에 얹는다.
  const coordsPath = path.join(DATA, "station-coords.json");
  const coords: Record<string, { lat: number; lng: number; src?: string }> =
    existsSync(coordsPath) ? JSON.parse(readFileSync(coordsPath, "utf8")) : {};

  let manualCoords = 0;
  for (const r of active) {
    if (r.lat == null || r.lng == null) continue;
    const id = r.station_id ?? manual[String(r.seq)];
    if (!id) continue;
    coords[id] = { lat: r.lat, lng: r.lng, src: "manual" };
    manualCoords++;
  }
  if (manualCoords > 0) {
    writeFileSync(coordsPath, JSON.stringify(coords, null, 0), "utf8");
  }

  console.log(`[pull] 명단 ${active.length}곳 (제외 ${rows.length - active.length}곳)`);
  console.log(`[pull] 수기 지정 주유소코드 ${Object.keys(manual).length}건, 수기 좌표 ${manualCoords}건`);

  // ── 임계값 ──────────────────────────────────────────────────────────
  const cfg = await fetchConfig();
  if (cfg) {
    writeFileSync(
      path.join(DATA, "thresholds.json"),
      JSON.stringify({
        gapYellow: cfg.gap_yellow,
        minSample: cfg.min_sample,
        minCompare: cfg.min_compare,
      }, null, 2),
      "utf8",
    );
    console.log(`[pull] 임계값 — 근접 +${cfg.gap_yellow}원 / 표본 ${cfg.min_sample} / 비교 ${cfg.min_compare}`);
  }

  // ── 외부 API 키 ─────────────────────────────────────────────────────
  //
  // 관리 화면에서 등록한 키를 뒤따르는 단계가 쓸 수 있게 넘긴다.
  // GitHub 시크릿이 아니라 Supabase 에서 온 값이라 로그에 자동 마스킹되지
  // 않으므로 add-mask 로 직접 가려준다.
  for (const name of ["OPINET_API_KEY", "VWORLD_API_KEY"]) {
    const value = (await fetchSecret(name))?.trim();
    if (!value) {
      if (mode() === "service") console.log(`[pull] ${name} 미등록`);
      continue;
    }
    if (process.env.GITHUB_ENV) {
      console.log(`::add-mask::${value}`);
      appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
      console.log(`[pull] ${name} 를 Supabase 에서 가져왔습니다.`);
    } else {
      console.log(`[pull] ${name} 가 Supabase 에 있습니다 (로컬에서는 환경변수로 직접 넣어주세요).`);
    }
  }
}

main().catch((e) => { console.error("[pull] 예외:", e); process.exit(1); });
