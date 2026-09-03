/**
 * 보조 — OpenStreetMap에서 착한주유소 좌표 채우기 (API 키 불필요)
 *
 *   Overpass API (amenity=fuel) → data/station-coords.json
 *
 * 정확한 좌표는 오피넷 detailById.do가 주는 값이 정답이고(`npm run coords`),
 * 이 스크립트는 OPINET_API_KEY가 없을 때 쓰는 차선책이다. OSM은 전국 주유소를
 * 다 담고 있지 않아 일부만 채워진다.
 *
 * 잘못된 곳에 핀을 꽂느니 비워두는 편이 낫기 때문에 두 조건을 모두 만족할 때만
 * 채택한다.
 *   1. 상호 정규화 결과가 정확히 일치
 *   2. 그 좌표가 해당 주유소의 시·군·구 폴리곤 안에 있을 것
 *
 * 참고로 Nominatim 지오코딩은 쓰지 않는다. 한국 도로명주소를 거의 못 찾고
 * (실측: 서울 강남 주소 → 대구, 포항 주소 → 서울) 엉뚱한 대상을 반환한다.
 *
 * 실행: npm run coords:osm
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName } from "../src/lib/match.ts";
import type { GoodStation } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const GEO = path.join(ROOT, "client", "public", "data", "geo-sigungu.json");

const OVERPASS = "https://overpass-api.de/api/interpreter";

/** 대한민국 전체 주유소. node는 좌표를, way/relation은 중심점을 받는다. */
const QUERY = `
[out:json][timeout:180];
area["ISO3166-1"="KR"][admin_level=2]->.kr;
(
  node["amenity"="fuel"](area.kr);
  way["amenity"="fuel"](area.kr);
);
out center;
`;

interface OsmEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface GeoFeature {
  properties: { sido: string; label: string; keys?: string[] };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

/** 링 내부 판정 — ray casting */
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

/** MultiPolygon 내부 판정. 외곽링 안이면서 구멍 밖이어야 한다. */
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

async function main() {
  const goodPath = path.join(DATA, "good-stations.json");
  const mappingPath = path.join(DATA, "station-mapping.json");
  if (!existsSync(goodPath)) {
    console.error("data/good-stations.json 이 없습니다. 먼저 `npm run normalize`.");
    process.exit(1);
  }
  if (!existsSync(GEO)) {
    console.error("client/public/data/geo-sigungu.json 이 없습니다. 먼저 `npm run geo`.");
    process.exit(1);
  }

  const good: GoodStation[] = JSON.parse(readFileSync(goodPath, "utf8"));
  const mapping: Record<string, { stationId: string }> = existsSync(mappingPath)
    ? JSON.parse(readFileSync(mappingPath, "utf8")) : {};
  const geo: { features: GeoFeature[] } = JSON.parse(readFileSync(GEO, "utf8"));

  // 지역키 → 폴리곤
  const featureByKey = new Map<string, GeoFeature>();
  for (const f of geo.features) {
    for (const k of f.properties.keys ?? [`${f.properties.sido}|${f.properties.label}`]) {
      featureByKey.set(k, f);
    }
  }

  console.log("[osm] Overpass 조회 중 (전국 주유소, 최대 3분)…");
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": "good-station-board/1.0 (KPETRO good station board)",
    },
    body: QUERY,
    signal: AbortSignal.timeout(200_000),
  });
  if (!res.ok) {
    console.error(`[osm] Overpass HTTP ${res.status}`);
    process.exit(1);
  }

  const json: { elements: OsmEl[] } = await res.json();
  console.log(`[osm] 주유소 ${json.elements.length}건 수신`);

  // 정규화 상호 → 후보 좌표들
  const byName = new Map<string, Array<{ lat: number; lng: number; name: string }>>();
  for (const e of json.elements) {
    const name = e.tags?.name;
    if (!name) continue;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    const key = normalizeName(name);
    const arr = byName.get(key);
    const rec = { lat, lng: lon, name };
    if (arr) arr.push(rec); else byName.set(key, [rec]);
  }
  console.log(`[osm] 이름 있는 주유소 ${byName.size}종`);

  // 기존 좌표는 보존한다. 오피넷으로 받은 정확한 값을 덮어쓰면 안 된다.
  const coordsPath = path.join(DATA, "station-coords.json");
  const coords: Record<string, { lat: number; lng: number; src?: string }> =
    existsSync(coordsPath) ? JSON.parse(readFileSync(coordsPath, "utf8")) : {};

  let matched = 0;
  let rejectedRegion = 0;
  let ambiguous = 0;
  let noName = 0;
  let skipped = 0;

  for (const g of good) {
    const stationId = mapping[String(g.seq)]?.stationId;
    if (!stationId) continue;
    if (coords[stationId] && coords[stationId].src !== "osm") { skipped++; continue; }

    const cands = byName.get(normalizeName(g.name));
    if (!cands || cands.length === 0) { noName++; continue; }

    const feature = featureByKey.get(g.regionKey);
    const inRegion = feature
      ? cands.filter((c) => pointInFeature(c.lng, c.lat, feature))
      : [];

    if (inRegion.length === 0) { rejectedRegion++; continue; }
    if (inRegion.length > 1) { ambiguous++; continue; }

    coords[stationId] = {
      lat: Math.round(inRegion[0].lat * 1e6) / 1e6,
      lng: Math.round(inRegion[0].lng * 1e6) / 1e6,
      src: "osm",
    };
    matched++;
  }

  writeFileSync(coordsPath, JSON.stringify(coords, null, 0), "utf8");

  console.log(`[osm] 완료 — 좌표 확보 ${matched}곳`);
  console.log(`  상호 불일치        ${noName}곳`);
  console.log(`  지역 밖이라 기각    ${rejectedRegion}곳`);
  console.log(`  같은 이름 다수 보류  ${ambiguous}곳`);
  console.log(`  기존 좌표 유지      ${skipped}곳`);
  console.log(`\n  data/station-coords.json (총 ${Object.keys(coords).length}곳)`);
  console.log("\n오피넷 키가 있으면 `npm run coords` 로 전량을 정확히 채울 수 있습니다.");
}

main().catch((e) => { console.error("[osm] 예외:", e); process.exit(1); });
