/**
 * 배경 지도 타일.
 *
 * 최대 확대 단계(구 또는 구가 없는 시·군)에서만 깔린다. 전국·시·도 단계에서는
 * 행정구역 색칠이 요점이라 타일이 오히려 방해가 된다.
 *
 * 좌표계가 맞아떨어지는 덕에 구현이 간단하다. 웹 지도 타일은 Web Mercator이고
 * 이 프로젝트도 d3의 geoMercator를 쓰므로, 타일의 네 모서리를 같은 투영으로
 * 변환하면 축에 나란한 사각형이 된다. 그 자리에 <image>를 놓으면 끝이다.
 */

export interface TileSource {
  url: string;
  attribution: string;
  maxZoom: number;
}

/**
 * 기본값은 OpenStreetMap 표준 타일. **API 키가 필요 없다.**
 *
 * 다른 무료 후보를 살펴봤지만 이게 남았다.
 *   - CARTO(basemaps.cartocdn.com): HTTP 200에 PNG를 돌려주지만 이미지에
 *     "API KEY REQUIRED" 워터마크가 찍혀 나온다. 지명도 로마자 표기다.
 *   - Nominatim/기타 지오코더: 좌표 문제라 여기와는 무관.
 *   - 브이월드(국토교통부): 한글 표기에 기관 표준이지만 키가 필요하다.
 *
 * OSM 표준 타일은 지명이 한글로 나와 국내 현황판에 적합하다. 다만 OSMF 타일
 * 사용정책상 **가벼운 사용**을 전제로 하고, 대량 트래픽은 허용하지 않는다.
 * 접속이 늘면 브이월드로 옮기는 것이 맞다. `.env` 로 교체된다.
 *
 *   VITE_TILE_URL=https://api.vworld.kr/req/wmts/1.0.0/{키}/Base/{z}/{y}/{x}.png
 *   VITE_TILE_ATTRIBUTION=국토교통부 브이월드
 */
export const DEFAULT_TILE: TileSource = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
};

export function tileSource(): TileSource {
  const url = import.meta.env.VITE_TILE_URL as string | undefined;
  if (!url) return DEFAULT_TILE;
  return {
    url,
    attribution: (import.meta.env.VITE_TILE_ATTRIBUTION as string) ?? "",
    maxZoom: Number(import.meta.env.VITE_TILE_MAX_ZOOM ?? 19),
  };
}

export interface Tile {
  key: string;
  url: string;
  /** 투영 좌표계에서의 위치와 크기 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 타일 x 인덱스 → 서쪽 경도 */
function tileLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** 타일 y 인덱스 → 북쪽 위도 */
function tileLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export interface TileViewport {
  /** d3 geoMercator 투영 */
  project: (p: [number, number]) => [number, number] | null;
  invert: (p: [number, number]) => [number, number] | null;
  /** 투영의 scale 값 */
  scale: number;
  /** 화면 변환 */
  k: number;
  tx: number;
  ty: number;
  width: number;
  height: number;
}

/**
 * 화면에 필요한 타일 목록을 만든다.
 *
 * 타일이 지나치게 많아지면(확대가 어긋났거나 화면이 큰 경우) 렌더링이 멈추므로
 * 상한을 둔다.
 */
export function visibleTiles(vp: TileViewport, source: TileSource, maxTiles = 240): Tile[] {
  // 화면 네 귀퉁이를 투영 좌표 → 경위도로 되돌린다.
  const corners: Array<[number, number]> = [
    [(0 - vp.tx) / vp.k, (0 - vp.ty) / vp.k],
    [(vp.width - vp.tx) / vp.k, (0 - vp.ty) / vp.k],
    [(0 - vp.tx) / vp.k, (vp.height - vp.ty) / vp.k],
    [(vp.width - vp.tx) / vp.k, (vp.height - vp.ty) / vp.k],
  ];

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const c of corners) {
    const ll = vp.invert(c);
    if (!ll) continue;
    const [lng, lat] = ll;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return [];

  // 투영의 세계 폭(px) = 2π·scale. 타일 한 장이 256px이 되는 z를 고른다.
  const worldPx = 2 * Math.PI * vp.scale * vp.k;
  let z = Math.round(Math.log2(worldPx / 256));
  z = Math.max(0, Math.min(source.maxZoom, z));

  let x0 = Math.floor(lngToTileX(minLng, z));
  let x1 = Math.ceil(lngToTileX(maxLng, z));
  let y0 = Math.floor(latToTileY(maxLat, z));
  let y1 = Math.ceil(latToTileY(minLat, z));

  const n = 2 ** z;
  x0 = Math.max(0, x0); x1 = Math.min(n, x1);
  y0 = Math.max(0, y0); y1 = Math.min(n, y1);

  // 너무 많으면 한 단계씩 낮춘다.
  while ((x1 - x0) * (y1 - y0) > maxTiles && z > 0) {
    z -= 1;
    x0 = Math.max(0, Math.floor(lngToTileX(minLng, z)));
    x1 = Math.min(2 ** z, Math.ceil(lngToTileX(maxLng, z)));
    y0 = Math.max(0, Math.floor(latToTileY(maxLat, z)));
    y1 = Math.min(2 ** z, Math.ceil(latToTileY(minLat, z)));
  }

  const tiles: Tile[] = [];
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      const nw = vp.project([tileLng(x, z), tileLat(y, z)]);
      const se = vp.project([tileLng(x + 1, z), tileLat(y + 1, z)]);
      if (!nw || !se) continue;

      // 이음매에 실선이 보이지 않도록 아주 조금 겹쳐 그린다.
      const w = se[0] - nw[0];
      const h = se[1] - nw[1];
      if (!(w > 0) || !(h > 0)) continue;

      tiles.push({
        key: `${z}/${x}/${y}`,
        url: source.url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)),
        x: nw[0],
        y: nw[1],
        w: w + 0.6,
        h: h + 0.6,
      });
    }
  }
  return tiles;
}
