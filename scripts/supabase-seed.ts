/**
 * 보조 — 기존 명단 449곳을 Supabase 로 옮긴다.
 *
 *   data/good-stations.json + station-mapping + station-coords → gs_station
 *
 * service_role 키는 쓰지 않는다. 접근코드로 로그인해서 관리 화면과 똑같은 경로
 * (gs_station_save)로 넣기 때문에, 화면에서 저장한 것과 결과가 완전히 같다.
 *
 * 실행:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... GS_ACCESS_CODE=kpetro npm run supabase:seed
 *
 * 여러 번 돌려도 안전하다(seq 기준 upsert).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GoodStation } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

const URL_ = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_ANON_KEY ?? "";
const CODE = process.env.GS_ACCESS_CODE ?? "kpetro";

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${fn} 실패 (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function main() {
  if (!URL_ || !KEY) {
    console.error("SUPABASE_URL 과 SUPABASE_ANON_KEY 환경변수가 필요합니다.");
    console.error("  Supabase 대시보드 → Settings → API 에서 Project URL 과 anon public 키를 복사하세요.");
    process.exit(1);
  }

  const goodPath = path.join(DATA, "good-stations.json");
  if (!existsSync(goodPath)) {
    console.error("data/good-stations.json 이 없습니다. 먼저 `npm run normalize`.");
    process.exit(1);
  }

  const good: GoodStation[] = JSON.parse(readFileSync(goodPath, "utf8"));

  const mappingPath = path.join(DATA, "station-mapping.json");
  const mapping: Record<string, { stationId: string }> = existsSync(mappingPath)
    ? JSON.parse(readFileSync(mappingPath, "utf8")) : {};

  const coordsPath = path.join(DATA, "station-coords.json");
  const coords: Record<string, { lat: number; lng: number }> = existsSync(coordsPath)
    ? JSON.parse(readFileSync(coordsPath, "utf8")) : {};

  console.log(`[seed] 로그인 중 (접근코드 ${CODE.replace(/./g, "*")})…`);
  const { token } = await rpc<{ token: string }>("gs_login", { p_code: CODE });
  console.log("[seed] 로그인 성공");

  let ok = 0;
  let failed = 0;

  for (const g of good) {
    const stationId = mapping[String(g.seq)]?.stationId ?? null;
    const c = stationId ? coords[stationId] : undefined;
    try {
      await rpc("gs_station_save", {
        p_token: token,
        p_seq: g.seq,
        p_name: g.name,
        p_address: g.address,
        p_sido: g.sido,
        p_sigungu: g.sigungu,
        p_sigungu_detail: g.sigunguDetail,
        p_region_key: g.regionKey,
        p_station_id: stationId,
        // 좌표는 자동 수집분이라 넣지 않는다. 여기 값은 '수기 보정'만 담는 자리다.
        p_lat: null,
        p_lng: null,
        p_active: true,
        p_note: "",
      });
      ok++;
      if (ok % 50 === 0) console.log(`  ${ok}/${good.length}`);
    } catch (e) {
      failed++;
      console.error(`  #${g.seq} ${g.name} 실패: ${e instanceof Error ? e.message : String(e)}`);
      if (failed > 10) {
        console.error("[seed] 실패가 너무 많아 중단합니다.");
        process.exit(1);
      }
    }
    void c; // 좌표는 위 주석대로 의도적으로 넣지 않는다
  }

  console.log(`\n[seed] 완료 — 저장 ${ok}곳, 실패 ${failed}곳`);
  console.log("관리 화면(#/admin)에서 확인하세요.");
}

main().catch((e) => { console.error("[seed] 예외:", e); process.exit(1); });
