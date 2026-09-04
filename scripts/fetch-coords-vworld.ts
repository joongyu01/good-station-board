/**
 * 좌표 수집 — 브이월드 지오코더 (국토교통부)
 *
 *   data/good-stations.json 의 도로명주소 → data/station-coords.json
 *
 * 착한주유소 449곳의 주소는 이미 다 갖고 있다. 문제는 한국 도로명주소를 제대로
 * 읽는 지오코더였는데, 브이월드가 그 역할을 한다. 오피넷 detailById 와 달리
 * 주유소 코드가 아니라 주소만 있으면 되므로 미매칭 3곳도 좌표가 붙는다.
 *
 * 안전장치 — OSM 때와 같은 원칙이다.
 * 변환된 좌표가 **그 주유소의 시·군·구 폴리곤 안에 있을 때만** 채택한다.
 * 지오코더가 엉뚱한 동네를 짚으면 핀이 조용히 틀린 자리에 꽂히기 때문이다.
 *
 * 실행: VWORLD_API_KEY=... npm run coords:vworld
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GoodStation } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const GEO = path.join(ROOT, "client", "public", "data", "geo-sigungu.json");

const API = "https://api.vworld.kr/req/address";

/** 요청 간 간격(ms). 공공 API라 완만하게 두드린다. */
const GAP_MS = 90;

/**
 * 지역 검증 완충 거리(m).
 *
 * 경계 폴리곤은 130m 정도 오차로 단순화돼 있고(build-geo 의 tolerance),
 * 애초에 경계에 바로 붙은 주유소도 있다. 엄격하게 안팎만 따지면 멀쩡한
 * 좌표가 기각된다 — 실제로 속초·아산·성북·대덕 4건이 경계에서 3~142m
 * 떨어진 지점인데 인접 시군구로 넘어갔다.
 *
 * 이 거리 안이면 받아들인다. 도시를 통째로 잘못 짚으면 수 km 가 나므로
 * 그런 건 여전히 걸러진다.
 */
const BOUNDARY_TOLERANCE_M = 300;

interface GeoFeature {
  properties: { sido: string; label: string; keys?: string[] };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInFeature(lng: number, lat: number, f: GeoFeature): boolean {
  for (const poly of f.geometry.coordinates) {
    if (!poly[0] || !pointInRing(lng, lat, poly[0])) continue;
    let inHole = false;
    for (let i = 1; i < poly.length; i++) {
      if (pointInRing(lng, lat, poly[i])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

/** 점에서 선분까지의 거리(m). 위경도를 미터로 환산해 잰다. */
function segmentDistanceM(
  px: number, py: number, x1: number, y1: number, x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t = 0;
  if (dx !== 0 || dy !== 0) {
    t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  }
  const cx = x1 + dx * t;
  const cy = y1 + dy * t;
  const mPerLat = 110540;
  const mPerLng = 111320 * Math.cos((py * Math.PI) / 180);
  return Math.hypot((px - cx) * mPerLng, (py - cy) * mPerLat);
}

/** 폴리곤 경계선까지의 최단거리(m). */
function distanceToFeatureM(lng: number, lat: number, f: GeoFeature): number {
  let min = Infinity;
  for (const poly of f.geometry.coordinates) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        min = Math.min(min, segmentDistanceM(lng, lat, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
      }
    }
  }
  return min;
}

/** 그 지역 안이거나, 경계에서 완충 거리 안이면 받아들인다. */
function nearFeature(lng: number, lat: number, f: GeoFeature): boolean {
  if (pointInFeature(lng, lat, f)) return true;
  return distanceToFeatureM(lng, lat, f) <= BOUNDARY_TOLERANCE_M;
}

/**
 * 읍·면 토큰을 뺀 주소.
 *
 * 브이월드는 "울주군 삼남면 하방로 26" 을 못 찾는데 "울주군 하방로 26" 은 찾는다.
 * 도로명주소 체계에서 도로명은 시·군 단위로 유일해서 읍·면이 들어가면 오히려
 * 매칭이 깨진다. 실측으로 5곳이 이 변형으로 해결됐다.
 */
function withoutEupMyeon(address: string): string {
  return address.split(/\s+/).filter((t) => !/(읍|면)$/.test(t)).join(" ");
}

type GeocodeResult =
  | { ok: true; lat: number; lng: number; type: "ROAD" | "PARCEL" }
  | { ok: false; reason: string };

/**
 * 주소 하나를 좌표로. 도로명으로 먼저 찾고, 실패하면 지번으로 한 번 더 본다.
 * 명단 주소가 대부분 도로명이지만 간혹 지번이 섞여 있다.
 */
async function geocode(address: string, key: string): Promise<GeocodeResult> {
  for (const type of ["ROAD", "PARCEL"] as const) {
    const url = `${API}?service=address&request=getCoord&version=2.0`
      + `&crs=epsg:4326&type=${type}&refine=true&simple=false&format=json`
      + `&address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`;

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      return { ok: false, reason: `network: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const raw = await res.text();
    let json: {
      response?: { status?: string; error?: { text?: string };
        result?: { point?: { x?: string; y?: string } } };
    };
    try { json = JSON.parse(raw); }
    catch { return { ok: false, reason: `JSON 아님: ${raw.slice(0, 120)}` }; }

    const r = json.response;
    if (r?.status === "OK" && r.result?.point) {
      const lng = Number(r.result.point.x);
      const lat = Number(r.result.point.y);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { ok: true, lat, lng, type };
    }
    if (r?.status === "ERROR") {
      // 키 문제 같은 건 재시도해도 소용없다. 바로 올려보낸다.
      return { ok: false, reason: `ERROR: ${r.error?.text ?? "사유 미상"}` };
    }
    // NOT_FOUND 면 다음 type 으로 넘어간다.
  }
  return { ok: false, reason: "NOT_FOUND" };
}

async function main() {
  const key = (process.env.VWORLD_API_KEY ?? "").trim();
  if (!key) {
    console.error("VWORLD_API_KEY 환경변수가 필요합니다.");
    console.error("  발급: https://www.vworld.kr → 오픈API → 인증키 발급 (무료)");
    console.error("  관리 화면(#/admin) → API 키 탭에 VWORLD_API_KEY 로 넣어두면");
    console.error("  수집 작업이 자동으로 가져다 씁니다.");
    process.exit(1);
  }

  const goodPath = path.join(DATA, "good-stations.json");
  if (!existsSync(goodPath)) {
    console.error("data/good-stations.json 이 없습니다. 먼저 `npm run supabase:pull` 또는 `npm run normalize`.");
    process.exit(1);
  }
  if (!existsSync(GEO)) {
    console.error("client/public/data/geo-sigungu.json 이 없습니다. 먼저 `npm run geo`.");
    process.exit(1);
  }

  const good: GoodStation[] = JSON.parse(readFileSync(goodPath, "utf8"));
  const geo: { features: GeoFeature[] } = JSON.parse(readFileSync(GEO, "utf8"));

  const featureByKey = new Map<string, GeoFeature>();
  for (const f of geo.features) {
    for (const k of f.properties.keys ?? [`${f.properties.sido}|${f.properties.label}`]) {
      featureByKey.set(k, f);
    }
  }

  const mappingPath = path.join(DATA, "station-mapping.json");
  const mapping: Record<string, { stationId: string }> = existsSync(mappingPath)
    ? JSON.parse(readFileSync(mappingPath, "utf8")) : {};

  // 오피넷이 들고 있는 현재 주소. 명단 주소로 못 찾을 때 대신 써본다.
  //
  // 명단은 행정구역 개편을 못 따라간 곳이 있다. 인천 서구가 검단구·서해구로
  // 분구됐는데 명단은 아직 `서구` 라서, 브이월드 주소DB(현행 기준)가 못 찾는다.
  // 오피넷 쪽 주소는 `서해구` 로 갱신돼 있다.
  const indexPath = path.join(DATA, "station-index.json");
  const stationIndex: Record<string, { address?: string }> = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8")) : {};

  const coordsPath = path.join(DATA, "station-coords.json");
  const coords: Record<string, { lat: number; lng: number; src?: string }> =
    existsSync(coordsPath) ? JSON.parse(readFileSync(coordsPath, "utf8")) : {};

  // 이미 정확한 출처(오피넷·수기)로 채운 건 건드리지 않는다.
  const keepSrc = new Set(["manual", undefined, "opinet"]);

  let ok = 0, outside = 0, notFound = 0, failed = 0, skipped = 0, noId = 0, viaOpinetAddr = 0, viaStripped = 0;
  const outsideSamples: string[] = [];
  let stop = false;

  console.log(`[vworld] 대상 ${good.length}곳`);

  for (const g of good) {
    if (stop) break;

    const id = mapping[String(g.seq)]?.stationId;
    if (!id) { noId++; continue; }

    const cur = coords[id];
    if (cur && keepSrc.has(cur.src)) { skipped++; continue; }

    let r = await geocode(g.address, key);
    await new Promise((res) => setTimeout(res, GAP_MS));

    // 못 찾으면 변형을 차례로 시도한다.
    //   1) 오피넷이 들고 있는 현재 주소 (행정구역 개편 반영본)
    //   2) 읍·면 토큰을 뺀 주소
    if (!r.ok && r.reason === "NOT_FOUND") {
      const alt = stationIndex[id]?.address?.trim();
      if (alt && alt !== g.address) {
        r = await geocode(alt, key);
        await new Promise((res) => setTimeout(res, GAP_MS));
        if (r.ok) viaOpinetAddr++;
      }
    }
    if (!r.ok && r.reason === "NOT_FOUND") {
      for (const base of [g.address, stationIndex[id]?.address?.trim()]) {
        if (!base) continue;
        const stripped = withoutEupMyeon(base);
        if (stripped === base) continue;
        r = await geocode(stripped, key);
        await new Promise((res) => setTimeout(res, GAP_MS));
        if (r.ok) { viaStripped++; break; }
      }
    }

    if (!r.ok) {
      if (r.reason.startsWith("ERROR")) {
        console.error(`[vworld] ${r.reason}`);
        console.error("[vworld] 키 문제로 보여 중단합니다.");
        stop = true;
        break;
      }
      if (r.reason === "NOT_FOUND") notFound++;
      else { failed++; if (failed <= 3) console.error(`  ${g.name}: ${r.reason}`); }
      continue;
    }

    // 지역 검증 — 엉뚱한 곳이면 버린다.
    const f = featureByKey.get(g.regionKey);
    if (f && !nearFeature(r.lng, r.lat, f)) {
      outside++;
      if (outsideSamples.length < 5) {
        const d = Math.round(distanceToFeatureM(r.lng, r.lat, f));
        outsideSamples.push(`${g.name} (${g.sido} ${g.sigungu}) → ${r.lat.toFixed(4)},${r.lng.toFixed(4)} · 경계에서 ${d}m`);
      }
      continue;
    }

    coords[id] = {
      lat: Math.round(r.lat * 1e6) / 1e6,
      lng: Math.round(r.lng * 1e6) / 1e6,
      src: "vworld",
    };
    ok++;
    if (ok % 50 === 0) console.log(`  ${ok}곳 확보`);
  }

  writeFileSync(coordsPath, JSON.stringify(coords, null, 0), "utf8");

  const total = good.filter((g) => mapping[String(g.seq)]).length;
  const have = Object.keys(coords).length;
  console.log(`\n[vworld] 완료 — 신규 ${ok}곳`);
  console.log(`  기존 좌표 유지        ${skipped}곳`);
  if (viaOpinetAddr) console.log(`  오피넷 주소로 구제     ${viaOpinetAddr}곳`);
  if (viaStripped) console.log(`  읍·면 빼고 구제        ${viaStripped}곳`);
  console.log(`  주소를 못 찾음        ${notFound}곳`);
  console.log(`  지역 밖이라 기각      ${outside}곳`);
  console.log(`  조회 실패            ${failed}곳`);
  if (noId) console.log(`  주유소코드 미매칭     ${noId}곳`);
  console.log(`\n  좌표 보유 ${have} / 대상 ${total}곳 (${((have / total) * 100).toFixed(1)}%)`);
  console.log(`  data/station-coords.json`);

  if (outsideSamples.length) {
    console.log("\n  지역 밖으로 판정된 예:");
    for (const s of outsideSamples) console.log(`    ${s}`);
  }
}

main().catch((e) => { console.error("[vworld] 예외:", e); process.exit(1); });
