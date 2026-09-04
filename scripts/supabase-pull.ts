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

  // 명단·설정·키는 서로 독립이다. 한 조각이 실패했다고 뒤를 건너뛰면 안 된다.
  // 예전에 설정 조회 실패가 API 키 읽기까지 통째로 삼킨 적이 있고, 명단 가드에
  // return 을 쓰자 같은 일이 다시 벌어졌다.
  await pullStations().catch((e) => {
    console.warn(`[pull] 명단 처리 실패 — 저장소 파일을 그대로 씁니다. (${e instanceof Error ? e.message : e})`);
  });

  // ── 임계값 ──────────────────────────────────────────────────────────
  //
  // 여기서 실패해도 뒤 단계를 죽이지 않는다. 한 번 그랬다가 스키마가 아직
  // 갱신되지 않은 상태에서 설정 조회가 던지는 바람에, 뒤따르는 API 키 읽기가
  // 통째로 건너뛰어졌다. 각 조각은 서로 독립적으로 실패해야 한다.
  const cfg = await fetchConfig().catch((e) => {
    console.warn(`[pull] 설정을 못 읽었습니다 — 코드 기본값을 씁니다. (${e instanceof Error ? e.message : e})`);
    console.warn("  supabase/schema.sql 을 SQL Editor 에서 다시 실행해 보세요.");
    return null;
  });
  if (cfg) {
    writeFileSync(
      path.join(DATA, "thresholds.json"),
      JSON.stringify({
        rankGreenMetro: cfg.rank_green_metro,
        rankGreenDefault: cfg.rank_green_default,
        rankYellowFactor: cfg.rank_yellow_factor,
      }, null, 2),
      "utf8",
    );
    console.log(`[pull] 기준 — 서울·경기 ${cfg.rank_green_metro}위 / 그 외 ${cfg.rank_green_default}위 / 노랑 ${cfg.rank_yellow_factor}배`);
  }

  // ── 외부 API 키 ─────────────────────────────────────────────────────
  //
  // 관리 화면에서 등록한 키를 뒤따르는 단계가 쓸 수 있게 넘긴다.
  // GitHub 시크릿이 아니라 Supabase 에서 온 값이라 로그에 자동 마스킹되지
  // 않으므로 add-mask 로 직접 가려준다.
  for (const name of ["OPINET_API_KEY", "VWORLD_API_KEY"]) {
    const value = (await fetchSecret(name).catch((e) => {
      console.warn(`[pull] ${name} 를 못 읽었습니다: ${e instanceof Error ? e.message : e}`);
      return null;
    }))?.trim();
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

/**
 * 명단을 내려받아 파일로 떨어뜨린다.
 *
 * 덮어쓰지 않고 넘어가는 경우가 둘 있다 — 비어 있을 때와, Supabase 쪽이
 * 저장소보다 오래됐을 때다. 둘 다 저장소 파일이 기준이 된다.
 */
async function pullStations(): Promise<void> {
  const rows = await fetchStations();
  if (rows.length === 0) {
    console.warn("[pull] 명단이 비어 있습니다. 덮어쓰지 않고 기존 파일을 유지합니다.");
    console.warn("  `npm run supabase:seed` 로 먼저 명단을 넣으세요.");
    return;
  }

  const active = rows.filter((r) => r.active);

  // ── 오래된 명단이 새 명단을 덮어쓰지 않게 막는다 ─────────────────────
  //
  // gs_station 은 관리 화면이 관리하는 원본이고 저장소 파일은 그 사본이다.
  // 그런데 저장소 쪽 명단만 먼저 갈아끼우고 Supabase 를 갱신하지 않으면,
  // 다음 수집에서 여기가 옛 명단을 도로 덮어써 배포까지 되돌아간다.
  // 실제로 472곳으로 바꾼 뒤 첫 실행에서 449곳으로 돌아갔다.
  //
  // 판별 기준은 폴(상표) 정보다. 새 명단 CSV 는 모든 행에 상표를 싣는다.
  // Supabase 쪽에 상표가 하나도 없는데 저장소 파일에는 있다면, 아직 새
  // 명단으로 갱신되지 않은 것이다. 그때는 덮어쓰지 않고 넘어간다.
  const localPath = path.join(DATA, "good-stations.json");
  if (existsSync(localPath)) {
    const local: GoodStation[] = JSON.parse(readFileSync(localPath, "utf8"));
    const localHasBrand = local.some((s) => s.brand);
    const remoteHasBrand = active.some((r) => r.brand);
    if (localHasBrand && !remoteHasBrand) {
      console.warn(
        `::warning::Supabase 명단(${active.length}곳)에 폴 정보가 없습니다. ` +
        `저장소 명단(${local.length}곳)을 그대로 씁니다.`,
      );
      console.warn("  관리 화면(#/admin)에서 명단 CSV 를 올리거나 `npm run supabase:seed` 를 실행하세요.");
      console.warn("  그때까지 명단·수기매핑은 저장소 파일이 기준입니다.");
      return;
    }
  }

  const stations: GoodStation[] = active.map((r) => ({
    seq: r.seq,
    name: r.name,
    address: r.address,
    sido: r.sido,
    sigungu: r.sigungu,
    sigunguDetail: r.sigungu_detail || r.sigungu,
    regionKey: r.region_key,
    // 명단 CSV 가 준 오피넷 주유소코드. 없으면 매칭 단계가 채운다.
    stationId: r.station_id ?? null,
    brand: (r.brand as GoodStation["brand"]) ?? null,
    isSelf: r.is_self ?? false,
    round: r.round ?? null,
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

}

main().catch((e) => { console.error("[pull] 예외:", e); process.exit(1); });
