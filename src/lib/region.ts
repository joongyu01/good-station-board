/**
 * 지역 정규화
 *
 * 착한주유소 명단(adress.csv)과 Opinet 수집 데이터는 시·도 표기가 서로 다르다.
 *   명단   : "강원" / "강원도", "경북" / "경상북도", "세종" / "세종시" / "세종특별자치시"
 *   Opinet : 지역 컬럼이 "시도 시군구" 형태
 * 두 쪽을 같은 canonical key로 떨어뜨려야 시군구 평균과 주유소 가격을 맞붙일 수 있다.
 */

/**
 * 표준 시·도 16종 (canonical)
 *
 * 광주광역시와 전라남도는 「전남광주통합특별시」로 통합되었다. Opinet 수집
 * 데이터의 지역 컬럼도 `전남광주 광산구`, `전남광주 진도군` 형태로 내려오며
 * `광주`·`전남` 토큰은 더 이상 존재하지 않는다. 통합시는 5개 자치구(옛 광주)와
 * 22개 시·군(옛 전남), 합쳐서 27개 시·군·구를 갖는다.
 */
export const SIDO_LIST = [
  "서울", "부산", "대구", "인천", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남광주", "경북", "경남", "제주",
] as const;

export type Sido = (typeof SIDO_LIST)[number];

/** 화면 표기용 정식 명칭. 짧은 canonical과 다른 것만 적는다. */
export const SIDO_LABELS: Partial<Record<Sido, string>> = {
  전남광주: "전남광주통합특별시",
};

/**
 * 시·도 별칭 → canonical.
 * 긴 표기부터 검사해야 "경상북도"가 "경북"보다 먼저 잡힌다.
 */
const SIDO_ALIASES: Array<[string, Sido]> = [
  ["서울특별시", "서울"], ["서울시", "서울"], ["서울", "서울"],
  ["부산광역시", "부산"], ["부산시", "부산"], ["부산", "부산"],
  ["대구광역시", "대구"], ["대구시", "대구"], ["대구", "대구"],
  ["인천광역시", "인천"], ["인천시", "인천"], ["인천", "인천"],
  // 통합시. 옛 표기(광주·전남)도 전부 여기로 모은다.
  // 주의: "경기 광주시"가 따로 있지만 그쪽은 "경기"로 먼저 잘리므로 충돌하지 않는다.
  ["전남광주통합특별시", "전남광주"], ["전남광주", "전남광주"],
  ["대전광역시", "대전"], ["대전시", "대전"], ["대전", "대전"],
  ["울산광역시", "울산"], ["울산시", "울산"], ["울산", "울산"],
  ["세종특별자치시", "세종"], ["세종시", "세종"], ["세종", "세종"],
  ["경기도", "경기"], ["경기", "경기"],
  ["강원특별자치도", "강원"], ["강원도", "강원"], ["강원", "강원"],
  ["충청북도", "충북"], ["충북", "충북"],
  ["충청남도", "충남"], ["충남", "충남"],
  ["전북특별자치도", "전북"], ["전라북도", "전북"], ["전북", "전북"],
  ["경상북도", "경북"], ["경북", "경북"],
  ["경상남도", "경남"], ["경남", "경남"],
  ["제주특별자치도", "제주"], ["제주도", "제주"], ["제주", "제주"],
];

/**
 * 통합 이전 표기 → 통합시.
 *
 * 명단 CSV는 대부분 옛 이름(`광주 북구`, `전남 진도군`)으로 적혀 있고, 일부만
 * `전남광주통합특별시`로 적혀 있다. Opinet은 전부 `전남광주`로 내려온다.
 * 셋을 같은 키로 모아야 시군구 평균과 붙는다.
 *
 * 보정한 건은 legacy 플래그로 표시해 리포트에 남긴다. 집계는 정상 동작하지만
 * 명단 원본을 통합 명칭으로 갱신하는 편이 낫기 때문이다.
 */
const LEGACY_SIDO: Array<[string, Sido]> = [
  ["광주광역시", "전남광주"], ["광주시", "전남광주"], ["광주", "전남광주"],
  ["전라남도", "전남광주"], ["전남", "전남광주"],
];

/**
 * 일반구(자치구가 아닌 행정구)를 둔 시.
 * "경남 창원시 마산합포구" 처럼 3토큰으로 들어오는데, 집계 단위는 시 레벨로 접는다.
 *
 * 이유가 둘 있다.
 *  1. Opinet 지역 컬럼이 일반구까지 내려가지 않는 경우가 있어 매칭이 어긋난다.
 *  2. 표준편차를 쓰려면 표본이 필요하다. 일반구로 쪼개면 구마다 주유소가 10개 안팎으로
 *     떨어져 σ가 불안정해진다. 시 레벨이면 수십 개가 확보된다.
 */
const CITIES_WITH_SUB_DISTRICTS = new Set([
  "수원시", "성남시", "안양시", "안산시", "고양시", "용인시", "부천시",
  "청주시", "천안시", "전주시", "포항시", "창원시", "화성시",
]);

export interface NormalizedRegion {
  /** canonical 시·도 (예: "경남") */
  sido: Sido;
  /** 집계 단위 시·군·구 (예: "창원시"). 세종은 "세종" */
  sigungu: string;
  /** 일반구까지 포함한 상세 (예: "창원시 마산합포구"). 없으면 sigungu와 동일 */
  sigunguDetail: string;
  /** 집계·조인에 쓰는 키 (예: "경남|창원시") */
  key: string;
  /** 비표준 표기를 보정했으면 원본 토큰을 담는다 */
  anomaly?: string;
}

/**
 * 별칭 전체를 길이 내림차순으로 한 번만 정렬해 둔다.
 * "전남광주통합특별시" → "전남광주" → "전남" 순으로 걸려야 통합시가 옛 표기에
 * 잡아먹히지 않는다.
 */
const ALL_ALIASES: Array<{ alias: string; sido: Sido; legacy: boolean }> = [
  ...SIDO_ALIASES.map(([alias, sido]) => ({ alias, sido, legacy: false })),
  ...LEGACY_SIDO.map(([alias, sido]) => ({ alias, sido, legacy: true })),
].sort((a, b) => b.alias.length - a.alias.length);

/** 주소/지역 문자열 앞부분에서 시·도를 떼어낸다. */
function takeSido(input: string): { sido: Sido; rest: string; anomaly?: string } | null {
  const s = input.trim();
  for (const { alias, sido, legacy } of ALL_ALIASES) {
    if (s.startsWith(alias)) {
      return {
        sido,
        rest: s.slice(alias.length).trim(),
        ...(legacy ? { anomaly: alias } : {}),
      };
    }
  }
  return null;
}

/**
 * 주소 또는 "시도 시군구" 문자열을 정규화한다.
 * 실패하면 null — 호출부에서 리포트로 남긴다.
 */
export function normalizeRegion(input: string | null | undefined): NormalizedRegion | null {
  if (!input) return null;

  const head = takeSido(input.replace(/\s+/g, " ").trim());
  if (!head) return null;

  const { sido, rest, anomaly } = head;

  // 세종은 시·군·구가 없다. 바로 아래가 읍면동이므로 자기 자신을 단위로 쓴다.
  if (sido === "세종") {
    return { sido, sigungu: "세종", sigunguDetail: "세종", key: "세종|세종", anomaly };
  }

  const tokens = rest.split(" ").filter(Boolean);
  const first = tokens[0] ?? "";

  if (!/(시|군|구)$/.test(first)) {
    // 시군구를 못 떼면 시·도만 아는 상태. 집계에서 제외된다.
    return null;
  }

  let sigungu = first;
  let sigunguDetail = first;

  // "창원시 마산합포구" — 일반구가 붙는 경우
  const second = tokens[1] ?? "";
  if (CITIES_WITH_SUB_DISTRICTS.has(first) && /구$/.test(second)) {
    sigunguDetail = `${first} ${second}`;
  }

  return {
    sido,
    sigungu,
    sigunguDetail,
    key: `${sido}|${sigungu}`,
    anomaly,
  };
}

/** 집계 키를 만든다. */
export function regionKey(sido: string, sigungu: string): string {
  return `${sido}|${sigungu}`;
}
