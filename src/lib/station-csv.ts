/**
 * 착한주유소 명단 CSV 파서.
 *
 * 빌드 스크립트(`npm run normalize`)와 관리 화면의 CSV 업로드가 **같은 코드**를
 * 쓴다. 두 곳이 따로 파싱하면 화면에서 올린 명단과 저장소에서 만든 명단이
 * 조용히 어긋난다.
 *
 * 기대하는 열 (헤더 이름으로 찾는다. 순서는 상관없다):
 *   선정차수, 번호, 지역, 상호, 주소, 상표, 셀프여부
 *
 * `번호` 는 오피넷 주유소코드다. 이 값이 있으면 상호·주소로 추정하는 매칭
 * 단계가 통째로 필요 없어진다.
 */
import { normalizeRegion } from "./region.ts";
import { brandCodeOf, type BrandCode } from "./brand.ts";
import type { GoodStation } from "./types.ts";

/** 따옴표를 존중하는 최소 CSV 파서. 주소에 콤마가 들어있는 행이 있다. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** "행복주유소 대표" → "행복주유소" */
function cleanName(raw: string): string {
  return raw.replace(/\s*대표\s*$/, "").trim();
}

/** 헤더 이름 후보들. 자료마다 표기가 조금씩 다르다. */
const HEADERS: Record<string, string[]> = {
  round: ["선정차수", "차수"],
  stationId: ["번호", "주유소코드", "코드", "고유번호"],
  region: ["지역"],
  name: ["상호", "주유소명", "상호명"],
  address: ["주소", "소재지"],
  brand: ["상표", "폴", "브랜드"],
  self: ["셀프여부", "셀프"],
};

function indexHeaders(cols: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [field, names] of Object.entries(HEADERS)) {
    out[field] = cols.findIndex((c) => names.includes(c.replace(/\s+/g, "")));
  }
  return out;
}

export interface ParseFailure {
  /** 원본 파일 행 번호 (1-base, 헤더 포함) */
  line: number;
  name: string;
  address: string;
  reason: string;
}

export interface ParseResult {
  stations: GoodStation[];
  failures: ParseFailure[];
  /** 시·도 표기를 통합 명칭으로 보정한 건 */
  anomalies: Array<{ seq: number; name: string; address: string; token: string }>;
  /** 코드로 해석하지 못한 상표 표기 → 등장 횟수 */
  unknownBrands: Map<string, number>;
  /** 오피넷 주유소코드가 비어 있는 건. 매칭 단계로 넘어간다. */
  missingIds: number;
}

/** 오피넷 주유소코드 형식 — 영문 1자 + 숫자 7자 (예: A0004302) */
const STATION_ID = /^[A-Z]\d{7}$/;

export function parseStationCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());

  const stations: GoodStation[] = [];
  const failures: ParseFailure[] = [];
  const anomalies: ParseResult["anomalies"] = [];
  const unknownBrands = new Map<string, number>();
  let missingIds = 0;

  if (lines.length === 0) {
    failures.push({ line: 0, name: "", address: "", reason: "빈 파일입니다." });
    return { stations, failures, anomalies, unknownBrands, missingIds };
  }

  const at = indexHeaders(parseCsvLine(lines[0]));
  if (at.name < 0 || at.address < 0) {
    failures.push({
      line: 1, name: "", address: "",
      reason: "헤더에서 `상호` 또는 `주소` 열을 찾지 못했습니다.",
    });
    return { stations, failures, anomalies, unknownBrands, missingIds };
  }

  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const pick = (k: string) => (at[k] >= 0 ? cols[at[k]] ?? "" : "");

    const name = cleanName(pick("name"));
    const address = pick("address");
    if (!name || !address) continue;

    // 지역 열이 있으면 그쪽을 먼저 본다. 주소보다 짧아 오탐이 적다.
    const region = normalizeRegion(pick("region")) ?? normalizeRegion(address);
    if (!region) {
      failures.push({ line: i + 1, name, address, reason: "시·도 또는 시·군·구 인식 실패" });
      continue;
    }

    const rawId = pick("stationId").toUpperCase();
    let stationId: string | null = null;
    if (STATION_ID.test(rawId)) {
      if (seen.has(rawId)) {
        failures.push({ line: i + 1, name, address, reason: `주유소코드 중복 (${rawId})` });
        continue;
      }
      seen.add(rawId);
      stationId = rawId;
    } else {
      // 코드가 없어도 버리지 않는다. 매칭 단계가 상호·주소로 추정한다.
      missingIds++;
    }

    const rawBrand = pick("brand");
    const brand: BrandCode | null = brandCodeOf(rawBrand);
    if (rawBrand && !brand) {
      unknownBrands.set(rawBrand, (unknownBrands.get(rawBrand) ?? 0) + 1);
    }

    const seq = stations.length + 1;
    if (region.anomaly) anomalies.push({ seq, name, address, token: region.anomaly });

    stations.push({
      seq,
      name,
      address,
      sido: region.sido,
      sigungu: region.sigungu,
      sigunguDetail: region.sigunguDetail,
      regionKey: region.key,
      stationId,
      brand,
      isSelf: /셀프/.test(pick("self")),
      round: pick("round") || null,
      ...(region.anomaly ? { anomaly: region.anomaly } : {}),
    });
  }

  return { stations, failures, anomalies, unknownBrands, missingIds };
}
