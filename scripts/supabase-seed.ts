/**
 * 보조 — 저장소의 명단을 Supabase 로 옮긴다.
 *
 *   data/good-stations.json + station-mapping → gs_station
 *
 * service_role 키는 쓰지 않는다. 접근코드로 로그인해서 관리 화면의 CSV 업로드와
 * 똑같은 경로(gs_station_replace)로 넣기 때문에 결과가 완전히 같다.
 *
 * 실행:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... GS_ACCESS_CODE=kpetro npm run supabase:seed
 *
 * 명단을 **통째로 갈아끼운다.** 좌표는 주유소코드가 같으면 서버가 이어받는다.
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

  console.log(`[seed] 로그인 중 (접근코드 ${CODE.replace(/./g, "*")})…`);
  const { token } = await rpc<{ token: string }>("gs_login", { p_code: CODE });
  console.log("[seed] 로그인 성공");

  const rows = good.map((g) => ({
    seq: g.seq,
    name: g.name,
    address: g.address,
    sido: g.sido,
    sigungu: g.sigungu,
    sigungu_detail: g.sigunguDetail,
    region_key: g.regionKey,
    station_id: g.stationId ?? mapping[String(g.seq)]?.stationId ?? "",
    brand: g.brand ?? "",
    is_self: g.isSelf ?? false,
    round: g.round ?? "",
  }));

  console.log(`[seed] ${rows.length}곳 전송 중…`);
  const r = await rpc<{ count: number; coords_kept: number }>("gs_station_replace", {
    p_token: token,
    p_rows: rows,
  });

  console.log(`
[seed] 완료 — ${r.count}곳 등록, 기존 좌표 ${r.coords_kept}곳 이어받음`);
  console.log("관리 화면(#/admin)에서 확인하세요.");
}

main().catch((e) => { console.error("[seed] 예외:", e); process.exit(1); });
