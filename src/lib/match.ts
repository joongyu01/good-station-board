/**
 * 착한주유소 명단 ↔ Opinet 주유소 코드 매칭 로직
 *
 * 이름으로 매칭하면 반드시 깨진다. 명단에 "행복주유소"가 4건, "대원주유소"·
 * "명진주유소"·"삼양주유소" 등 동일 상호가 여러 지역에 흩어져 있다.
 * 그래서 도로명주소를 1순위로 두고, 이름은 같은 지역 안에서만 보조로 쓴다.
 */

/** 도로명 + 건물번호 */
export interface RoadAddress {
  road: string;
  bldg: string;
}

/**
 * 도로명주소에서 "도로명 + 건물번호"를 뽑는다.
 *
 * 까다로운 형태들:
 *   "강원 철원군 서면 와수1로 40"        → 와수1로 / 40
 *   "서울 강서구 양천로53길 97 (가양동)"  → 양천로53길 / 97
 *   "광주 서구 상무대로1206번길 3"        → 상무대로1206번길 / 3
 *   "인천 서구 백범로 630번길 44"         → 백범로630번길 / 44
 *   "경남 창원시 마산회원구 3.15대로 524" → 3.15대로 / 524
 *   "전남 담양군 가사문학면 장단길 12-2"  → 장단길 / 12-2
 */
const ROAD_RE =
  /([가-힣A-Za-z0-9.]*(?:대로|로|길))(?:\s*(\d+[가-힣]*번?길))?\s*(\d+(?:-\d+)?)(?!\d)/g;

export function parseRoadAddress(address: string | null | undefined): RoadAddress | null {
  if (!address) return null;
  // 괄호 안 법정동은 도로명 판정에 방해가 되므로 떼어낸다.
  const cleaned = address.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  ROAD_RE.lastIndex = 0;
  while ((m = ROAD_RE.exec(cleaned)) !== null) last = m;
  if (!last) return null;

  const road = (last[1] + (last[2] ?? "")).replace(/\s+/g, "");
  const bldg = last[3];
  if (!road || !bldg) return null;
  return { road, bldg };
}

/** 도로명주소 매칭 키. 시군구가 같아야 하므로 regionKey를 앞에 붙인다. */
export function addressKey(regionKey: string, addr: RoadAddress): string {
  return `${regionKey}|${addr.road}|${addr.bldg}`;
}

/**
 * 상호 정규화. 법인격 표기와 공백·기호를 걷어낸다.
 *   "(주)평동제일주유소" → "평동제일주유소"
 *   "㈜더착한주유소"     → "더착한주유소"
 *   "동일석유(주)개나리주유소" → "동일석유개나리주유소"
 */
export function normalizeName(name: string): string {
  return name
    .replace(/주식회사|유한회사|㈜|㈐|\(주\)|\(유\)|\(사\)|\(재\)/g, "")
    .replace(/[\s\-_.·,'"“”‘’()[\]{}]/g, "")
    .toLowerCase();
}

/** 레벤슈타인 거리. 짧은 상호끼리 비교하므로 단순 DP로 충분하다. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = [...cur];
  }
  return prev[b.length];
}

/** 0~1 유사도. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export type MatchMethod =
  | "address"       // 도로명 + 건물번호 정확 일치 (같은 시군구)
  | "address-sido"  // 도로명 + 건물번호 정확 일치 (같은 시·도, 시군구 불일치)
  | "name-exact"    // 상호 완전 일치 (같은 시군구, 후보 1개)
  | "name-sido"     // 상호 완전 일치 (같은 시·도, 시군구 불일치)
  | "name-fuzzy"    // 상호 유사 (같은 시군구, 후보 1개)
  | "manual"        // 수기 지정
  | "unmatched";

export const METHOD_SCORE: Record<MatchMethod, number> = {
  address: 100,
  "address-sido": 95,
  "name-exact": 85,
  "name-sido": 70,
  "name-fuzzy": 60,
  manual: 100,
  unmatched: 0,
};

/**
 * 시·도 단위 주소 매칭 키.
 *
 * 행정구역 개편으로 명단과 Opinet의 시·군·구가 어긋나는 경우가 있다.
 * 인천 서구는 검단구·서해구로 분구되었는데 명단은 아직 `서구`로 적혀 있다.
 * 도로명 + 건물번호는 한 시·도 안에서 사실상 유일하므로, 시군구가 달라도
 * 이 조합이 일치하면 같은 주유소로 봐도 안전하다.
 */
export function sidoAddressKey(sido: string, addr: RoadAddress): string {
  return `${sido}|${addr.road}|${addr.bldg}`;
}

/** 이 값 미만이면 자동 확정하지 않고 수기 확인 대상으로 넘긴다. */
export const FUZZY_THRESHOLD = 0.82;
