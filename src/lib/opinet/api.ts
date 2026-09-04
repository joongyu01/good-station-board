/**
 * Opinet OpenAPI 클라이언트.
 *
 * 전국 가격은 스크래핑으로 받고(표준편차를 내려면 전 주유소 분포가 필요하다),
 * 이 API는 착한주유소 449곳의 좌표·주소를 보강하는 데만 쓴다.
 *
 * 키는 OPINET_API_KEY 환경변수.
 */
import { katecToWgs84, type LatLng } from "../coords.ts";

const DETAIL_URL = "https://www.opinet.co.kr/api/detailById.do";
/** 무료 등급에도 들어 있는 기본 엔드포인트. 키 자체가 유효한지 가르는 데 쓴다. */
const AVG_URL = "https://www.opinet.co.kr/api/avgAllPrice.do";

export interface StationDetail {
  stationId: string;
  stationName: string;
  address: string;
  brand: string;
  coord: LatLng | null;
}

function apiKey(): string {
  const key = process.env.OPINET_API_KEY;
  if (!key) throw new Error("OPINET_API_KEY 환경변수가 없습니다.");
  return key;
}

/**
 * 인증키가 살아 있는지 확인한다.
 *
 * detailById 가 전건 빈 응답일 때, 키가 아예 안 먹는 것인지 그 엔드포인트만
 * 등급에서 빠진 것인지 구분해야 한다. 전국 평균가는 무료 등급에도 들어 있으므로
 * 이게 되면 키는 유효한 것이다.
 */
export async function verifyKey(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${AVG_URL}?out=json&code=${apiKey()}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; good-station-board/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };

    const raw = await res.text();
    let json: unknown;
    try { json = JSON.parse(raw); }
    catch { return { ok: false, detail: `JSON 아님: ${raw.slice(0, 120)}` }; }

    const list = (json as { RESULT?: { OIL?: unknown[] } })?.RESULT?.OIL ?? [];
    if (list.length === 0) return { ok: false, detail: "평균가도 빈 응답 — 키가 아직 활성화되지 않았습니다" };
    return { ok: true, detail: `평균가 ${list.length}종 수신 — 키는 유효합니다` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 실패 사유. 오피넷은 키가 틀려도 HTTP 200 에 빈 배열을 돌려주기 때문에
 * 상태 코드만으로는 원인을 알 수 없다. 무엇이 잘못됐는지 구분해서 올려보낸다.
 */
export type DetailFailure =
  | { kind: "empty" }          // RESULT.OIL 이 비어 있음 — 키 문제이거나 없는 코드
  | { kind: "http"; status: number }
  | { kind: "parse"; body: string }
  | { kind: "network"; message: string };

export interface DetailOutcome {
  detail: StationDetail | null;
  failure?: DetailFailure;
}

/** 주유소 코드로 상세 조회. */
export async function fetchStationDetail(stationId: string): Promise<DetailOutcome> {
  let raw = "";
  try {
    const url = `${DETAIL_URL}?out=json&code=${apiKey()}&id=${encodeURIComponent(stationId)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; good-station-board/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { detail: null, failure: { kind: "http", status: res.status } };

    raw = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { detail: null, failure: { kind: "parse", body: raw.slice(0, 200) } };
    }

    const oil = (json as { RESULT?: { OIL?: Record<string, string>[] } })?.RESULT?.OIL?.[0];
    if (!oil) return { detail: null, failure: { kind: "empty" } };

    const x = parseFloat(oil.GIS_X_COOR);
    const y = parseFloat(oil.GIS_Y_COOR);

    return {
      detail: {
        stationId,
        stationName: oil.OS_NM ?? stationId,
        address: oil.VAN_ADR ?? oil.NEW_ADR ?? "",
        brand: oil.POLL_DIV_CD ?? "",
        coord: katecToWgs84(x, y),
      },
    };
  } catch (e) {
    return {
      detail: null,
      failure: { kind: "network", message: e instanceof Error ? e.message : String(e) },
    };
  }
}

export interface DetailsResult {
  details: Map<string, StationDetail>;
  /** 실패 사유별 집계. 무엇이 문제인지 한눈에 보려고 남긴다. */
  failures: Map<string, number>;
  /** 처음 몇 건의 실패 상세. 원인 추적용. */
  samples: Array<{ id: string; failure: DetailFailure }>;
}

/** 동시 실행 수를 제한해 순차에 가깝게 돌린다. 공개 API에 부하를 주지 않기 위함. */
export async function fetchStationDetails(
  stationIds: string[],
  concurrency = 4,
  onProgress?: (done: number, total: number) => void,
): Promise<DetailsResult> {
  const details = new Map<string, StationDetail>();
  const failures = new Map<string, number>();
  const samples: Array<{ id: string; failure: DetailFailure }> = [];
  let done = 0;

  const queue = [...stationIds];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) break;
      const r = await fetchStationDetail(id);
      if (r.detail) {
        details.set(id, r.detail);
      } else if (r.failure) {
        failures.set(r.failure.kind, (failures.get(r.failure.kind) ?? 0) + 1);
        if (samples.length < 3) samples.push({ id, failure: r.failure });
      }
      done++;
      onProgress?.(done, stationIds.length);
      await new Promise((r2) => setTimeout(r2, 120)); // 완만하게
    }
  });

  await Promise.all(workers);
  return { details, failures, samples };
}
