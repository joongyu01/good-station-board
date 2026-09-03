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

/** 주유소 코드로 상세 조회. 실패하면 null. */
export async function fetchStationDetail(stationId: string): Promise<StationDetail | null> {
  try {
    const url = `${DETAIL_URL}?out=json&code=${apiKey()}&id=${encodeURIComponent(stationId)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; good-station-board/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const oil = json?.RESULT?.OIL?.[0];
    if (!oil) return null;

    const x = parseFloat(oil.GIS_X_COOR);
    const y = parseFloat(oil.GIS_Y_COOR);

    return {
      stationId,
      stationName: oil.OS_NM ?? stationId,
      address: oil.VAN_ADR ?? oil.NEW_ADR ?? "",
      brand: oil.POLL_DIV_CD ?? "",
      coord: katecToWgs84(x, y),
    };
  } catch {
    return null;
  }
}

/** 동시 실행 수를 제한해 순차에 가깝게 돌린다. 공개 API에 부하를 주지 않기 위함. */
export async function fetchStationDetails(
  stationIds: string[],
  concurrency = 4,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, StationDetail>> {
  const out = new Map<string, StationDetail>();
  let done = 0;

  const queue = [...stationIds];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) break;
      const detail = await fetchStationDetail(id);
      if (detail) out.set(id, detail);
      done++;
      onProgress?.(done, stationIds.length);
      await new Promise((r) => setTimeout(r, 120)); // 완만하게
    }
  });

  await Promise.all(workers);
  return out;
}
