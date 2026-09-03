/**
 * 보조 — OpenStreetMap에서 착한주유소 좌표 채우기 (API 키 불필요)
 *
 *   Overpass API (amenity=fuel) → data/station-coords.json
 *
 * 정확한 좌표는 오피넷 detailById.do가 주는 값이 정답이고(`npm run coords`),
 * 이 스크립트는 OPINET_API_KEY가 없을 때 쓰는 차선책이다. OSM은 전국 주유소를
 * 다 담고 있지 않아 일부만 채워진다.
 *
 * 매칭 전략
 *   1. OSM 주유소를 먼저 시·군·구로 분류한다 (좌표 → 폴리곤 내부 판정).
 *   2. 착한주유소가 속한 시·군·구 안에서만 상호를 비교한다.
 *
 * 지역을 먼저 확정하고 나면 그 안에 주유소가 몇 개 없으므로 상호를 느슨하게
 * 맞춰도 엉뚱한 곳에 꽂힐 위험이 작다. 지역 확인 없이 전국에서 이름만 맞추면
 * `행복주유소`처럼 흔한 상호가 곧바로 오매칭이 된다.
 *
 * OSM 주소 태그(addr:street)는 표본상 3%에만 있어 주소 매칭은 쓸 수 없다.
 * Nominatim 지오코딩도 쓰지 않는다 — 한국 도로명주소를 거의 못 찾는다
 * (실측: 서울 강남 주소 → 대구, 포항 주소 → 서울).
 *
 * 실행: npm run coords:osm
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName, similarity } from "../src/lib/match.ts";
import type { GoodStation } from "../src/lib/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const GEO = path.join(ROOT, "client", "public", "data", "geo-sigungu.json");

const OVERPASS = "https://overpass-api.de/api/interpreter";

const QUERY = `
[out:json][timeout:180];
area["ISO3166-1"="KR"][admin_level=2]->.kr;
(
  node["amenity"="fuel"](area.kr);
  way["amenity"="fuel"](area.kr);
);
out center;
`;

/**
 * 지역을 확정한 뒤 적용하는 상호 유사도 하한.
 *
 * 처음에 0.6으로 뒀다가 전부 오매칭이 나왔다. `(주)서해에너지`가 `SK 주유소`에,
 * `㈜성동에너지`가 `SK에너지`에 붙는 식이었다. 한국 주유소 상호는 "…주유소",
 * "…에너지", "…농협주유소" 처럼 어미가 겹쳐서 편집거리가 실제보다 가깝게 나온다.
 * 핀이 적은 것보다 틀린 핀이 나쁘므로 높게 잡는다.
 * 0.85에서도 `동춘천농협주유소`가 `춘천농협주유소`에 붙었다 — 둘 다 명단에 있는
 * 별개 주유소다. 사실상 정확히 같은 이름만 통과시킨다.
 */
const SIM_ACCEPT = 0.92;
/** 1등이 2등보다 이만큼 앞서야 채택한다. 비슷한 후보가 둘이면 보류. */
const SIM_MARGIN = 0.12;

/**
 * OSM 상호에 흔히 붙는 정유사·부가 표기. 우리 명단은 대체로 이런 접두어가 없어서
 * 떼어내야 같은 주유소로 알아본다. 예) "SK 포항대원 주유소" ↔ "포항대원주유소"
 */
const BRAND_NOISE = [
  "sk에너지", "sk", "gs칼텍스", "gs", "s-oil", "soil", "에쓰오일", "현대오일뱅크",
  "hd현대오일뱅크", "오일뱅크", "알뜰", "농협", "nh", "셀프", "self", "주유소", "충전소",
];

/** 브랜드 표기를 걷어낸 핵심 이름. 비교의 마지막 수단으로 쓴다. */
function coreName(name: string): string {
  let s = normalizeName(name);
  for (const b of BRAND_NOISE) s = s.split(b).join("");
  return s;
}

interface OsmEl {
  type: string; id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

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

interface Bbox { minLng: number; minLat: number; maxLng: number; maxLat: number }

function bboxOf(f: GeoFeature): Bbox {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const poly of f.geometry.coordinates) {
    for (const [lng, lat] of poly[0] ?? []) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

interface Candidate { lat: number; lng: number; names: string[] }

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

  const indexed = geo.features.map((f) => ({ f, bbox: bboxOf(f) }));

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
  if (!res.ok) { console.error(`[osm] Overpass HTTP ${res.status}`); process.exit(1); }

  const json: { elements: OsmEl[] } = await res.json();
  console.log(`[osm] 주유소 ${json.elements.length}건 수신`);

  // ── OSM 주유소를 시·군·구로 분류 ────────────────────────────────────
  const byRegion = new Map<string, Candidate[]>();
  let placed = 0;

  for (const e of json.elements) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (lat == null || lng == null) continue;

    // brand·operator 태그는 쓰지 않는다. "SK에너지", "GS칼텍스" 같은 정유사명이라
    // 상호에 "에너지"가 들어간 주유소마다 잘못 붙는다.
    const names = [e.tags?.name, e.tags?.["name:ko"]]
      .filter((v): v is string => !!v);
    if (names.length === 0) continue;

    for (const { f, bbox } of indexed) {
      if (lng < bbox.minLng || lng > bbox.maxLng || lat < bbox.minLat || lat > bbox.maxLat) continue;
      if (!pointInFeature(lng, lat, f)) continue;
      for (const key of f.properties.keys ?? [`${f.properties.sido}|${f.properties.label}`]) {
        const arr = byRegion.get(key);
        const rec = { lat, lng, names };
        if (arr) arr.push(rec); else byRegion.set(key, [rec]);
      }
      placed++;
      break;
    }
  }
  console.log(`[osm] 시·군·구 확정 ${placed}건, ${byRegion.size}개 지역`);

  // ── 기존 좌표 보존. 오피넷으로 받은 정확한 값을 덮어쓰면 안 된다. ──
  const coordsPath = path.join(DATA, "station-coords.json");
  const coords: Record<string, { lat: number; lng: number; src?: string }> =
    existsSync(coordsPath) ? JSON.parse(readFileSync(coordsPath, "utf8")) : {};

  let matched = 0, noRegion = 0, weak = 0, ambiguous = 0, skipped = 0;
  // 근사 출처라 어떤 이름끼리 붙었는지 남겨야 사람이 잘못된 핀을 찾아낼 수 있다.
  const rows: Array<{ seq: number; name: string; region: string; osm: string; sim: number }> = [];

  for (const g of good) {
    const stationId = mapping[String(g.seq)]?.stationId;
    if (!stationId) continue;
    if (coords[stationId] && coords[stationId].src !== "osm") { skipped++; continue; }

    const cands = byRegion.get(g.regionKey);
    if (!cands || cands.length === 0) { noRegion++; continue; }

    const target = normalizeName(g.name);
    const targetCore = coreName(g.name);

    const scored = cands.map((c) => {
      let best = 0;
      for (const n of c.names) {
        best = Math.max(best, similarity(target, normalizeName(n)));
        // 브랜드 표기를 걷어낸 핵심 이름이 정확히 같을 때만 인정한다.
        // 포함 관계까지 인정하면 "대원" 이 "대원에너지"·"대원석유"에 모두 붙는다.
        const core = coreName(n);
        if (core.length >= 3 && targetCore.length >= 3 && core === targetCore) {
          best = Math.max(best, 0.97);
        }
      }
      return { c, sim: best };
    }).sort((a, b) => b.sim - a.sim);

    if (scored[0].sim < SIM_ACCEPT) { weak++; continue; }
    if (scored.length > 1 && scored[0].sim - scored[1].sim < SIM_MARGIN) { ambiguous++; continue; }

    coords[stationId] = {
      lat: Math.round(scored[0].c.lat * 1e6) / 1e6,
      lng: Math.round(scored[0].c.lng * 1e6) / 1e6,
      src: "osm",
    };
    rows.push({
      seq: g.seq, name: g.name, region: `${g.sido} ${g.sigungu}`,
      osm: scored[0].c.names[0], sim: scored[0].sim,
    });
    matched++;
  }

  writeFileSync(coordsPath, JSON.stringify(coords, null, 0), "utf8");

  const total = good.filter((g) => mapping[String(g.seq)]).length;
  console.log(`[osm] 완료 — 좌표 확보 ${matched}곳 / 대상 ${total}곳 (${((matched / total) * 100).toFixed(1)}%)`);
  console.log(`  해당 시·군·구에 OSM 주유소 없음  ${noRegion}곳`);
  console.log(`  상호가 충분히 닮지 않음          ${weak}곳`);
  console.log(`  비슷한 후보가 둘 이상이라 보류    ${ambiguous}곳`);
  console.log(`  기존 좌표 유지                   ${skipped}곳`);
  console.log(`\n  data/station-coords.json (총 ${Object.keys(coords).length}곳)`);

  // ── 감사용 리포트 ───────────────────────────────────────────────────
  // 근사 출처이므로 어떤 이름끼리 붙었는지 남겨야 사람이 잘못된 핀을 찾아낼 수 있다.
  rows.sort((a, b) => a.sim - b.sim);
  const low = rows.filter((r) => r.sim < 0.9);

  const out: string[] = [];
  out.push("# OSM 좌표 매칭 리포트\n");
  out.push("오피넷 키 없이 OpenStreetMap에서 채운 좌표입니다. **근사 출처이므로 검토가 필요합니다.**\n");
  out.push(`- 좌표 확보: **${matched}곳** / 대상 ${total}곳`);
  out.push(`- 상호가 완전히 같지는 않은 건: **${low.length}곳** (표 위쪽)\n`);
  out.push("판정 근거는 둘입니다. (1) 좌표가 해당 시·군·구 폴리곤 안에 있을 것,");
  out.push("(2) 그 지역 안에서 상호가 충분히 닮았을 것. 지역을 먼저 확정하므로 `행복주유소` 같은");
  out.push("흔한 상호가 다른 지역과 섞이지는 않지만, **같은 지역 안에서는 잘못 붙을 수 있습니다.**\n");
  out.push("틀린 건은 `data/station-coords.json` 에서 해당 항목을 지우면 핀이 사라집니다.");
  out.push("오피넷 키를 등록하면 `npm run coords` 가 전량을 정확한 값으로 덮어씁니다.\n");
  out.push("| 유사도 | seq | 명단 상호 | OSM 상호 | 지역 |");
  out.push("|---:|---:|---|---|---|");
  for (const r of rows) {
    out.push(`| ${r.sim.toFixed(2)} | ${r.seq} | ${r.name} | ${r.osm} | ${r.region} |`);
  }

  writeFileSync(path.join(DATA, "coords-report.md"), out.join("\n") + "\n", "utf8");
  console.log("  data/coords-report.md");
}

main().catch((e) => { console.error("[osm] 예외:", e); process.exit(1); });
