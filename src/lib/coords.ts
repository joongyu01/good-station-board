/**
 * 좌표계 변환.
 *
 * Opinet API가 주는 GIS_X_COOR / GIS_Y_COOR 는 WGS84 경위도가 아니라 KATEC(TM128)
 * 평면직각좌표다. GeoJSON 지도에 그대로 찍으면 한반도 밖으로 날아간다.
 */
import proj4 from "proj4";

/** KATEC (TM128) — Bessel 타원체, 7-파라미터 변환 포함 */
const KATEC =
  "+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 " +
  "+ellps=bessel +units=m +no_defs " +
  "+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43";

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

/** 대한민국 대략 경계. 변환 결과 검증용. */
const KOREA_BBOX = { minLng: 124.0, maxLng: 132.5, minLat: 32.5, maxLat: 39.0 };

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * KATEC → WGS84.
 * 변환 결과가 한반도 범위를 벗어나면 null을 반환한다. 좌표계가 바뀌었거나
 * 원본이 깨진 경우인데, 조용히 엉뚱한 위치에 핀을 꽂는 것보다 빠뜨리는 게 낫다.
 */
export function katecToWgs84(x: number, y: number): LatLng | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return null;

  try {
    const [lng, lat] = proj4(KATEC, WGS84, [x, y]);
    if (
      !Number.isFinite(lng) || !Number.isFinite(lat) ||
      lng < KOREA_BBOX.minLng || lng > KOREA_BBOX.maxLng ||
      lat < KOREA_BBOX.minLat || lat > KOREA_BBOX.maxLat
    ) {
      return null;
    }
    return { lat: round6(lat), lng: round6(lng) };
  } catch {
    return null;
  }
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
