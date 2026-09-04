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
export interface ChipBounds {
  x0: number; y0: number; x1: number; y1: number;
}

/** 비켜 가야 하는 고정 사각형. 스스로는 움직이지 않는다. */
export interface Obstacle {
  x: number; y: number; w: number; h: number;
}

/**
 * @param obstacles 칩이 덮으면 안 되는 고정 도형. 주유기 아이콘이 여기 들어간다.
 *   칩끼리만 밀어내면 이름표가 남의 아이콘 위에 내려앉는다 — 이름표를 키우고
 *   강릉시처럼 주유소가 몰린 곳에서 실제로 그랬다.
 */
export function relaxChips(
  chips: Chip[],
  bounds: ChipBounds,
  iterations = 60,
  pad = 2,
  obstacles: Obstacle[] = [],
): Chip[] {
  const out = chips.map((c) => ({ ...c }));

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

    // 고정 도형은 밀리지 않는다. 칩만 비켜난다.
    for (const c of out) {
      for (const o of obstacles) {
        const dx = o.x - c.x;
        const dy = o.y - c.y;
        const overlapX = (c.w + o.w) / 2 + pad - Math.abs(dx);
        const overlapY = (c.h + o.h) / 2 + pad - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapY < overlapX) c.y -= overlapY * (dy < 0 ? -1 : 1);
        else c.x -= overlapX * (dx < 0 ? -1 : 1);
      }
    }

    // 화면 밖으로 나가지 않게 잡아둔다.
    //
    // 경계는 SVG 상자가 아니라 **지금 보이는 범위**다. 확대·이동을 하면 둘이
    // 달라지는데, SVG 상자로 잡으면 기본 확대율이 1이 아닐 때 라벨이 화면
    // 밖으로 밀려난다.
    for (const c of out) {
      c.x = Math.min(bounds.x1 - c.w / 2 - 2, Math.max(bounds.x0 + c.w / 2 + 2, c.x));
      c.y = Math.min(bounds.y1 - c.h / 2 - 2, Math.max(bounds.y0 + c.h / 2 + 2, c.y));
    }

    if (!moved) break;
  }

  return out;
}

/**
 * 핀 이름표 자리 잡기 — 후보 위치 중에서 고른다.
 *
 * 서로 밀어내는 방식(relaxChips)은 이름표가 작을 때는 잘 듣지만, 커지고 나서
 * 주유소가 몰린 곳(강릉시 6곳)에서는 수렴하지 않았다. 밀어낸 이름표가 다른
 * 아이콘 위에 내려앉고, 그것을 다시 밀면 또 다른 것과 부딪히기를 되풀이한다.
 *
 * 그래서 아이콘 둘레의 정해진 자리 몇 곳을 후보로 두고, **이미 놓인 이름표와
 * 모든 아이콘을 피하는 첫 자리**를 고른다. 어느 자리도 깨끗하지 않으면 겹치는
 * 넓이가 가장 작은 자리를 쓴다. 자리는 유한하니 반드시 끝난다.
 *
 * 위쪽부터 차례로 놓는다. 순서가 고정돼야 화면을 다시 그려도 이름표가 춤추지 않는다.
 */
export interface PinLabel {
  id: string;
  anchor: { x: number; y: number };
  w: number;
  h: number;
}

export interface PlacedLabel extends PinLabel {
  x: number;
  y: number;
}

function overlapArea(a: Obstacle, b: Obstacle): number {
  const x = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const y = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return x > 0 && y > 0 ? x * y : 0;
}

export function placePinLabels(
  labels: PinLabel[],
  icons: Obstacle[],
  bounds: ChipBounds,
  icon: { w: number; h: number },
  gap: number,
): PlacedLabel[] {
  // 위에서 아래로, 같은 높이면 왼쪽부터. 그려지는 순서와 무관하게 자리가 고정된다.
  const order = [...labels].sort(
    (a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x,
  );

  const placed: PlacedLabel[] = [];

  for (const l of order) {
    const dx = l.w / 2 + icon.w / 2 + gap;
    const up = icon.h + l.h / 2 + gap;
    const down = l.h / 2 + gap;

    // 아이콘 바로 위를 가장 먼저 본다. 그다음 옆, 아래, 그리고 한 칸 더 멀리.
    const candidates: Array<[number, number]> = [
      [0, -up],
      [dx, -icon.h / 2], [-dx, -icon.h / 2],
      [0, down],
      [dx, -up], [-dx, -up],
      [dx, down], [-dx, down],
      [0, -up - l.h - gap],
      [0, down + l.h + gap],
      [dx, -up - l.h - gap], [-dx, -up - l.h - gap],
    ];

    let best: { x: number; y: number; cost: number } | null = null;

    for (const [ox, oy] of candidates) {
      const x = Math.min(bounds.x1 - l.w / 2 - 2, Math.max(bounds.x0 + l.w / 2 + 2, l.anchor.x + ox));
      const y = Math.min(bounds.y1 - l.h / 2 - 2, Math.max(bounds.y0 + l.h / 2 + 2, l.anchor.y + oy));
      const box = { x, y, w: l.w, h: l.h };

      let cost = 0;
      for (const ic of icons) cost += overlapArea(box, ic);
      for (const p of placed) cost += overlapArea(box, { x: p.x, y: p.y, w: p.w, h: p.h });

      if (cost === 0) { best = { x, y, cost }; break; }
      if (!best || cost < best.cost) best = { x, y, cost };
    }

    placed.push({ ...l, x: best!.x, y: best!.y });
  }

  // 넘겨받은 순서대로 돌려준다. 호출부가 id 로 다시 찾지 않아도 되게.
  const byId = new Map(placed.map((p) => [p.id, p]));
  return labels.map((l) => byId.get(l.id)!);
}
