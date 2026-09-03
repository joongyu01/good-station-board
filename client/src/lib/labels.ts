/**
 * 지도 라벨 배치.
 *
 * 무게중심(centroid)은 한국 행정구역에 잘 안 맞는다. 경기도는 서울을 둘러싸고
 * 있어서 무게중심이 서울 위에 얹히고(실측 20px), 전남·경남처럼 오목한 도형도
 * 중심이 바깥으로 새어나간다.
 *
 * 그래서 **최대내접원의 중심**(pole of inaccessibility)을 쓴다. 폴리곤 안쪽에서
 * 경계로부터 가장 먼 점이라 라벨이 항상 도형 안에 들어가고, 그 반지름이
 * "라벨을 놓을 여유가 얼마나 되는지"까지 알려준다.
 *
 * 그다음 배지끼리 겹치지 않게 서로 밀어낸다. 서울·대전·대구·울산처럼 작은
 * 광역시도 개수 배지를 빠뜨리지 않기 위해서다.
 */

export interface Point { x: number; y: number }

/** 점이 링 내부인지 — ray casting */
function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 점에서 링까지의 최단거리 */
function distToRing(x: number, y: number, ring: number[][]): number {
  let min = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    let dx = x2 - x1;
    let dy = y2 - y1;
    let px = x1;
    let py = y1;
    if (dx !== 0 || dy !== 0) {
      const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
      if (t > 1) { px = x2; py = y2; }
      else if (t > 0) { px = x1 + dx * t; py = y1 + dy * t; }
    }
    const d = Math.hypot(x - px, y - py);
    if (d < min) min = d;
  }
  return min;
}

/**
 * 최대내접원 중심을 격자 탐색으로 근사한다.
 * 화면에 동시에 뜨는 폴리곤이 수십 개 수준이라 격자 탐색으로 충분히 빠르다.
 */
export function poleOfInaccessibility(ring: number[][]): { x: number; y: number; r: number } {
  if (ring.length < 3) return { x: 0, y: 0, r: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;

  const N = 20;
  let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, r: -1 };

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = minX + (w * i) / N;
      const y = minY + (h * j) / N;
      if (!pointInRing(x, y, ring)) continue;
      const d = distToRing(x, y, ring);
      if (d > best.r) best = { x, y, r: d };
    }
  }

  // 찾은 지점 주변을 한 번 더 조밀하게 훑는다.
  if (best.r >= 0) {
    const step = Math.max(w, h) / N;
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const x = best.x + (step * i) / 4;
        const y = best.y + (step * j) / 4;
        if (!pointInRing(x, y, ring)) continue;
        const d = distToRing(x, y, ring);
        if (d > best.r) best = { x, y, r: d };
      }
    }
  }

  if (best.r < 0) best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, r: 0 };
  return best;
}

export interface Chip {
  id: string;
  /** 실제 지역 위치 — 배지가 밀려나면 여기까지 지시선을 긋는다 */
  anchor: Point;
  /** 배지 중심 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 배지끼리 겹치지 않도록 밀어낸다.
 *
 * 완벽한 배치를 찾는 대신 몇 차례 밀어내기를 반복한다. 지도 라벨은 조금
 * 어긋나도 지시선이 있으면 읽히고, 완전 해를 찾느라 화면이 굳는 것보다 낫다.
 */
export function relaxChips(chips: Chip[], bounds: { w: number; h: number }, iterations = 60): Chip[] {
  const out = chips.map((c) => ({ ...c }));
  const pad = 2;

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;

    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = (a.w + b.w) / 2 + pad - Math.abs(dx);
        const overlapY = (a.h + b.h) / 2 + pad - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        moved = true;
        // 겹침이 적은 축으로 밀어낸다 — 움직임이 최소가 된다.
        if (overlapY < overlapX) {
          const push = (overlapY / 2) * (dy < 0 ? -1 : 1);
          a.y -= push;
          b.y += push;
        } else {
          const push = (overlapX / 2) * (dx < 0 ? -1 : 1);
          a.x -= push;
          b.x += push;
        }
      }
    }

    // 화면 밖으로 나가지 않게 잡아둔다.
    for (const c of out) {
      c.x = Math.min(bounds.w - c.w / 2 - 2, Math.max(c.w / 2 + 2, c.x));
      c.y = Math.min(bounds.h - c.h / 2 - 2, Math.max(c.h / 2 + 2, c.y));
    }

    if (!moved) break;
  }

  return out;
}
