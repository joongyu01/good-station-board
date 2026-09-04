/**
 * 주유소 폴(상표) 코드.
 *
 * 명단 CSV 의 `상표` 열에 적힌 표기를 두 글자 안팎의 코드로 줄인다. 화면에서는
 * `대경주유소(HD)` 처럼 상호 뒤 괄호로 붙는다.
 */
export const BRAND_CODES = ["HD", "SOIL", "SK", "GS", "AL", "NH", "EX", "PB"] as const;
export type BrandCode = (typeof BRAND_CODES)[number];

/** 코드 → 정식 명칭. 툴팁과 범례에 쓴다. */
export const BRAND_LABELS: Record<BrandCode, string> = {
  HD: "HD현대오일뱅크",
  SOIL: "S-OIL",
  SK: "SK에너지",
  GS: "GS칼텍스",
  AL: "알뜰주유소",
  NH: "농협(NH-OIL)",
  EX: "도로공사 알뜰",
  PB: "무폴(자가상표)",
};

/**
 * 명단 CSV 의 상표 표기 → 코드.
 *
 * 키는 공백·하이픈·괄호를 지우고 소문자로 접은 형태다. 같은 상표라도 자료마다
 * `S-OIL` / `S OIL` / `에쓰오일` 처럼 다르게 적혀 오는 탓이다.
 *
 * 두 가지는 오피넷 분류를 그대로 따랐다.
 *   - `알뜰(ex)` 는 고속도로 EX 알뜰이다. 일반 `알뜰주유소`(자영·NH알뜰)와 구분된다.
 *   - `자가상표` 는 정유사 폴을 달지 않은 무폴이다.
 */
const ALIASES: Record<string, BrandCode> = {
  // HD현대오일뱅크
  hd현대오일뱅크: "HD", 현대오일뱅크: "HD", hdoilbank: "HD", 오일뱅크: "HD", hd: "HD",
  // S-OIL
  soil: "SOIL", 에쓰오일: "SOIL", 에스오일: "SOIL", s오일: "SOIL",
  // SK에너지
  sk에너지: "SK", sk: "SK", skenergy: "SK",
  // GS칼텍스
  gs칼텍스: "GS", gs: "GS", gscaltex: "GS",
  // 알뜰 — 고속도로(EX) 를 먼저 구분해야 한다
  알뜰ex: "EX", ex알뜰: "EX", 도로공사알뜰: "EX", 고속도로알뜰: "EX", ex: "EX",
  알뜰주유소: "AL", 알뜰: "AL", al: "AL",
  // 농협
  nhoil: "NH", 농협: "NH", nh알뜰: "NH", 농협알뜰: "NH", nh: "NH",
  // 무폴
  자가상표: "PB", 무폴: "PB", 자가: "PB", pb: "PB",
};

function fold(raw: string): string {
  return raw.replace(/[\s\-_.()·]/g, "").toLowerCase();
}

/** 상표 표기를 코드로. 모르는 표기는 null 이고, 호출부가 리포트에 남긴다. */
export function brandCodeOf(raw: string | null | undefined): BrandCode | null {
  if (!raw) return null;
  return ALIASES[fold(raw)] ?? null;
}

/** `대경주유소` + `HD` → `대경주유소(HD)` */
export function withBrand(name: string, brand: BrandCode | null): string {
  return brand ? `${name}(${brand})` : name;
}
