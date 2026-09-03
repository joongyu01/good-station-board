/**
 * 5단계 — 행정구역 경계 데이터 생성
 *
 *   data/geo/*-raw.json (kostat 2018)
 *     → client/public/data/geo-sido.json
 *     → client/public/data/geo-sigungu.json
 *     → data/geo-crosswalk-report.md
 *
 * 원본은 2018년 기준이라 현행 행정구역과 어긋나는 곳이 있다. 아래 크로스워크로
 * 맞춘다. 신설된 구(검단구·서해구·영종구·제물포구)는 2018년 자료로 경계를
 * 만들어낼 수 없으므로, 모체 폴리곤 하나에 여러 현행 구를 묶어 표시한다.
 * 지어낸 경계를 그리는 것보다 묶어서 정직하게 보여주는 편이 낫다.
 *
 * 실행: npx tsx scripts/build-geo.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIDO_LABELS, type Sido } from "../src/lib/region.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GEO_DIR = path.join(ROOT, "data", "geo");
const OUT_DIR = path.join(ROOT, "client", "public", "data");

/** kostat 구형 시·도 코드 → canonical 시·도. 24(광주)와 36(전남)이 함께 전남광주로 간다. */
const SIDO_CODE: Record<string, Sido> = {
  "11": "서울", "21": "부산", "22": "대구", "23": "인천", "24": "전남광주",
  "25": "대전", "26": "울산", "29": "세종", "31": "경기", "32": "강원",
  "33": "충북", "34": "충남", "35": "전북", "36": "전남광주", "37": "경북",
  "38": "경남", "39": "제주",
};

/** 일반구를 둔 시 — 폴리곤을 모체 시로 접는다. src/lib/region.ts 와 같은 목록. */
const SUB_DISTRICT_CITIES = [
  "수원시", "성남시", "안양시", "안산시", "고양시", "용인시", "부천시",
  "청주시", "천안시", "전주시", "포항시", "창원시", "화성시",
];

/** 시·도가 바뀐 기초자치단체. 군위군은 2023년 경북에서 대구로 편입되었다. */
const SIDO_REASSIGN: Record<string, Sido> = {
  "경북|군위군": "대구",
};

/**
 * 2018년 폴리곤 이름 → 현행 시·군·구.
 *
 * `units` 가 2개 이상이면 그 폴리곤 하나가 여러 현행 구를 덮는다는 뜻이다.
 * 지도에서는 한 덩어리로 칠하고, 상세 패널에서 개별 구를 나열한다.
 */
const CROSSWALK: Record<string, { label: string; units: string[] }> = {
  "세종|세종시": { label: "세종", units: ["세종"] },
  "인천|남구": { label: "미추홀구", units: ["미추홀구"] },
  "인천|서구": { label: "검단구·서해구", units: ["검단구", "서해구"] },
  "인천|중구": { label: "제물포구·영종구", units: ["제물포구", "영종구"] },
  // 동구는 제물포구로 흡수되었다. 중구 폴리곤이 이미 그 조합을 대표하므로
  // 동구 폴리곤은 같은 표시 단위에 합류시킨다.
  "인천|동구": { label: "제물포구·영종구", units: ["제물포구", "영종구"] },
};

type Ring = number[][];
type Poly = Ring[];

interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: Poly[] | Poly };
}

/** 폴리곤을 항상 MultiPolygon 좌표(Poly[])로 통일한다. */
function toMulti(geom: Feature["geometry"]): Poly[] {
  return geom.type === "Polygon" ? [geom.coordinates as Poly] : (geom.coordinates as Poly[]);
}

// ── 단순화 ────────────────────────────────────────────────────────────
/** 점에서 선분까지의 수직거리 제곱. */
function sqSegDist(p: number[], a: number[], b: number[]): number {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas-Peucker. tolerance 단위는 degree. */
function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring;
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(ring[i], ring[first], ring[last]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > sqTol && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  // 링은 닫혀 있어야 한다. 3점 미만이면 버린다.
  if (out.length < 4) return [];
  return out;
}

/** 좌표 자릿수 축소. 소수 4자리 ≈ 11m. */
function quantize(ring: Ring, digits: number): Ring {
  const f = 10 ** digits;
  const out: Ring = [];
  let prev = "";
  for (const [x, y] of ring) {
    const qx = Math.round(x * f) / f;
    const qy = Math.round(y * f) / f;
    const key = `${qx},${qy}`;
    if (key !== prev) { out.push([qx, qy]); prev = key; }
  }
  // 닫힘 보장
  if (out.length > 2 && (out[0][0] !== out.at(-1)![0] || out[0][1] !== out.at(-1)![1])) {
    out.push([out[0][0], out[0][1]]);
  }
  return out.length >= 4 ? out : [];
}

/** 링의 대략적 넓이. 아주 작은 섬을 걸러내는 데 쓴다. */
function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

function simplifyMulti(polys: Poly[], tolerance: number, minArea: number, digits: number): Poly[] {
  const out: Poly[] = [];
  for (const poly of polys) {
    const rings: Poly = [];
    for (let i = 0; i < poly.length; i++) {
      const simplified = quantize(simplifyRing(poly[i], tolerance), digits);
      if (simplified.length === 0) continue;
      // 외곽링(i=0)이 너무 작으면 폴리곤 전체를 버린다.
      if (i === 0 && ringArea(simplified) < minArea) { rings.length = 0; break; }
      rings.push(simplified);
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

// ── 본체 ──────────────────────────────────────────────────────────────
function collapseCity(name: string): string {
  for (const c of SUB_DISTRICT_CITIES) if (name.startsWith(c)) return c;
  return name;
}

/**
 * 경계 원본 내려받기.
 *
 * 26MB짜리라 저장소에 넣지 않는다(.gitignore). 단순화한 결과물만 커밋하므로,
 * 경계를 다시 만들 때만 받으면 된다.
 */
const SOURCES: Array<{ file: string; url: string }> = [
  {
    file: "provinces-raw.json",
    url: "https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-provinces-2018-geo.json",
  },
  {
    file: "municipalities-raw.json",
    url: "https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-municipalities-2018-geo.json",
  },
];

async function ensureSources() {
  mkdirSync(GEO_DIR, { recursive: true });
  for (const { file, url } of SOURCES) {
    const dest = path.join(GEO_DIR, file);
    if (existsSync(dest)) continue;
    console.log(`[geo] ${file} 내려받는 중…`);
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`${file} 다운로드 실패: HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
}

async function main() {
  await ensureSources();
  const munPath = path.join(GEO_DIR, "municipalities-raw.json");

  const mun: { features: Feature[] } = JSON.parse(readFileSync(munPath, "utf8"));
  console.log(`[geo] 원본 시군구 폴리곤 ${mun.features.length}개`);

  // 표시 단위별로 폴리곤을 모은다.
  interface Group { sido: Sido; label: string; units: string[]; polys: Poly[] }
  const groups = new Map<string, Group>();
  const unmapped: string[] = [];

  // 일반구 레이어 — 시 단위 아래로 한 단계 더 내려가기 위한 것.
  interface DistrictGroup { sido: Sido; city: string; district: string; polys: Poly[] }
  const districts = new Map<string, DistrictGroup>();

  for (const f of mun.features) {
    const code = String(f.properties.code ?? "");
    let sido = SIDO_CODE[code.slice(0, 2)];
    if (!sido) { unmapped.push(`${f.properties.name} (code ${code})`); continue; }

    const rawName = String(f.properties.name ?? "");
    let name = collapseCity(rawName);

    // "수원시장안구" 처럼 시 이름 뒤에 구가 붙어 있으면 구 레이어에도 넣는다.
    if (name !== rawName) {
      const district = rawName.slice(name.length);
      const dKey = `${sido}|${name}|${district}`;
      let d = districts.get(dKey);
      if (!d) { d = { sido, city: name, district, polys: [] }; districts.set(dKey, d); }
      d.polys.push(...toMulti(f.geometry));
    }

    // 시·도 재배정 (군위군 등)
    const reassign = SIDO_REASSIGN[`${sido}|${name}`];
    if (reassign) sido = reassign;

    const cross = CROSSWALK[`${sido}|${name}`];
    const label = cross?.label ?? name;
    const units = cross?.units ?? [name];

    const key = `${sido}|${label}`;
    let g = groups.get(key);
    if (!g) { g = { sido, label, units, polys: [] }; groups.set(key, g); }
    g.polys.push(...toMulti(f.geometry));
  }

  console.log(`[geo] 표시 단위 ${groups.size}개로 병합`);
  if (unmapped.length) console.warn(`[geo] 시·도 미상 ${unmapped.length}건: ${unmapped.join(", ")}`);

  // ── 시군구 레이어 ──────────────────────────────────────────────────
  const sigunguFeatures = [...groups.values()].map((g) => ({
    type: "Feature" as const,
    properties: {
      sido: g.sido,
      label: g.label,
      // 이 폴리곤이 대표하는 현행 시·군·구들. 집계 키와 붙일 때 쓴다.
      units: g.units,
      keys: g.units.map((u) => `${g.sido}|${u}`),
    },
    geometry: {
      type: "MultiPolygon" as const,
      coordinates: simplifyMulti(g.polys, 0.0012, 0.00003, 4),
    },
  })).filter((f) => f.geometry.coordinates.length > 0);

  // ── 시도 레이어 ────────────────────────────────────────────────────
  //
  // 시군구 폴리곤을 시·도별로 쌓아 올리면 내부 경계선이 전부 드러나 전국 지도가
  // 그물처럼 보인다. 시·도 원본을 따로 쓴다. 광주(24)와 전남(36)만 한 피처로 합친다.
  const provPath = path.join(GEO_DIR, "provinces-raw.json");
  const bySido = new Map<Sido, Poly[]>();

  if (existsSync(provPath)) {
    const prov: { features: Feature[] } = JSON.parse(readFileSync(provPath, "utf8"));
    for (const f of prov.features) {
      const sido = SIDO_CODE[String(f.properties.code ?? "").slice(0, 2)];
      if (!sido) continue;
      const arr = bySido.get(sido) ?? [];
      arr.push(...toMulti(f.geometry));
      bySido.set(sido, arr);
    }
    console.log(`[geo] 시·도 원본 사용 (provinces-raw.json)`);
  } else {
    // 원본이 없으면 시군구를 합쳐 대체한다. 내부 경계선이 보이는 것을 감수한다.
    console.warn("[geo] provinces-raw.json 없음 — 시군구 병합으로 대체 (내부 경계선이 보입니다)");
    for (const g of groups.values()) {
      const arr = bySido.get(g.sido) ?? [];
      arr.push(...g.polys);
      bySido.set(g.sido, arr);
    }
  }

  const sidoFeatures = [...bySido.entries()].map(([sido, polys]) => ({
    type: "Feature" as const,
    properties: { sido, label: SIDO_LABELS[sido] ?? sido },
    geometry: {
      type: "MultiPolygon" as const,
      coordinates: simplifyMulti(polys, 0.004, 0.0005, 3),
    },
  })).filter((f) => f.geometry.coordinates.length > 0);

  // ── 일반구 레이어 ──────────────────────────────────────────────────
  //
  // 2018년 원본에 구 폴리곤이 있는 시만 여기 들어간다. 부천시(2024년 구 복원)와
  // 화성시(만세구 신설)는 원본이 단일 폴리곤이라 구 단계를 제공하지 못한다.
  // 해당 시는 시 단위에서 드릴다운이 멈춘다.
  const districtFeatures = [...districts.values()].map((d) => ({
    type: "Feature" as const,
    properties: {
      sido: d.sido,
      city: d.city,
      district: d.district,
      label: d.district,
      key: `${d.sido}|${d.city}`,
    },
    geometry: {
      type: "MultiPolygon" as const,
      coordinates: simplifyMulti(d.polys, 0.0008, 0.00002, 4),
    },
  })).filter((f) => f.geometry.coordinates.length > 0);

  mkdirSync(OUT_DIR, { recursive: true });
  const sidoOut = { type: "FeatureCollection", features: sidoFeatures };
  const sgOut = { type: "FeatureCollection", features: sigunguFeatures };
  const dOut = { type: "FeatureCollection", features: districtFeatures };
  writeFileSync(path.join(OUT_DIR, "geo-sido.json"), JSON.stringify(sidoOut), "utf8");
  writeFileSync(path.join(OUT_DIR, "geo-sigungu.json"), JSON.stringify(sgOut), "utf8");
  writeFileSync(path.join(OUT_DIR, "geo-district.json"), JSON.stringify(dOut), "utf8");

  const sizeOf = (p: string) => (readFileSync(p).byteLength / 1024).toFixed(0) + " KB";
  console.log(`[geo] geo-sido.json     ${sidoFeatures.length}개 시·도, ${sizeOf(path.join(OUT_DIR, "geo-sido.json"))}`);
  console.log(`[geo] geo-sigungu.json  ${sigunguFeatures.length}개 단위, ${sizeOf(path.join(OUT_DIR, "geo-sigungu.json"))}`);
  console.log(`[geo] geo-district.json ${districtFeatures.length}개 일반구, ${sizeOf(path.join(OUT_DIR, "geo-district.json"))}`);
  {
    const cities = [...new Set(districtFeatures.map((f) => `${f.properties.sido} ${f.properties.city}`))];
    console.log(`[geo]   구 단계 제공: ${cities.join(", ")}`);
    const missing = SUB_DISTRICT_CITIES.filter(
      (c) => !districtFeatures.some((f) => f.properties.city === c),
    );
    if (missing.length) console.log(`[geo]   구 경계 없음(시 단위에서 멈춤): ${missing.join(", ")}`);
  }

  // ── 크로스워크 리포트 ──────────────────────────────────────────────
  const rep: string[] = [];
  rep.push("# 행정구역 경계 크로스워크\n");
  rep.push("경계 원본은 **kostat 2018년** 기준입니다. 현행 행정구역과 다음과 같이 맞췄습니다.\n");
  rep.push("## 시·도\n");
  rep.push("| 처리 | 내용 |");
  rep.push("|---|---|");
  rep.push("| 병합 | 광주광역시(24) + 전라남도(36) → **전남광주통합특별시** |");
  rep.push("| 재배정 | 경북 군위군 → **대구 군위군** (2023년 편입) |");
  rep.push("\n## 시·군·구\n");
  rep.push("| 2018 폴리곤 | 현행 단위 | 비고 |");
  rep.push("|---|---|---|");
  for (const [k, v] of Object.entries(CROSSWALK)) {
    const note = v.units.length > 1
      ? "**신설 구의 경계가 원본에 없어 한 단위로 묶어 표시**"
      : "개칭";
    rep.push(`| ${k.split("|")[1]} | ${v.units.join(", ")} | ${note} |`);
  }
  rep.push(`\n일반구를 둔 시 ${SUB_DISTRICT_CITIES.length}곳(${SUB_DISTRICT_CITIES.join(", ")})은 `);
  rep.push("구별 폴리곤을 시 단위로 접었습니다. 표본을 확보해 표준편차를 안정시키기 위한 집계 단위와 일치시킨 것입니다.\n");
  rep.push("\n## 한계\n");
  rep.push("- 인천 검단구·서해구, 제물포구·영종구는 2018년 경계로 분리할 수 없어 묶어서 칠합니다. ");
  rep.push("지도에서는 한 덩어리로 보이지만 상세 패널에는 개별 구가 나뉘어 나옵니다.\n");
  rep.push("- 최신 경계 데이터를 확보하면 `data/geo/municipalities-raw.json` 을 교체하고 `CROSSWALK` 를 비우면 됩니다.\n");
  writeFileSync(path.join(ROOT, "data", "geo-crosswalk-report.md"), rep.join("\n"), "utf8");
  console.log(`[geo] data/geo-crosswalk-report.md`);
}

main().catch((e) => { console.error("[geo] 예외:", e); process.exit(1); });
