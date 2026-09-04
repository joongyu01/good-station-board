/**
 * 행정구역 드릴다운 지도.
 *
 *   1단계  전국 시·도
 *   2단계  시·군·구
 *   3단계  일반구 — 수원·창원·포항처럼 구를 둔 시만 해당한다.
 *   4단계  상세 — 최대 확대 단계. 실제 지도 타일 위에 주유소 핀을 찍는다.
 *
 * 상세 단계는 더 내려갈 곳이 없는 지역을 골랐을 때 열린다. 구가 있는 시는 구를
 * 골랐을 때, 경북처럼 일반구가 없는 곳은 시·군을 골랐을 때다. 전국 단위에 핀을
 * 449개 찍으면 알아볼 수가 없어서 이 단계에서만 보여준다.
 *
 * 착한주유소가 없는 지역은 그리지 않는다. 대신 상위 행정구역 외곽선을 옅게 깔아
 * 위치를 가늠할 수 있게 한다.
 *
 * 배지·핀 위치는 최대내접원 중심에서 출발해 서로 밀어낸 결과다. lib/labels.ts 참고.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath, type GeoPermissibleObjects } from "d3-geo";
import type { GeoCollection, GeoFeature, RegionSummary, StationSignal } from "../lib/board.ts";
import { SIGNAL_COLORS, formatPrice } from "../lib/board.ts";
import { poleOfInaccessibility, relaxChips, type Chip } from "../lib/labels.ts";
import { tileSource, visibleTiles } from "../lib/basemap.ts";

const WIDTH = 720;
const HEIGHT = 860;
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
/** 이 거리(px)를 넘게 끌어야 지도 이동으로 친다. 클릭 시 손떨림과 구분하기 위함. */
const DRAG_THRESHOLD = 5;

interface Transform { k: number; x: number; y: number }
const IDENTITY: Transform = { k: 1, x: 0, y: 0 };

interface Props {
  sidoGeo: GeoCollection;
  sigunguGeo: GeoCollection;
  districtGeo: GeoCollection;
  /** 현재 유종의 착한주유소 전체. 상세 단계에서 해당 지역 것만 걸러 핀으로 찍는다. */
  stations: StationSignal[];
  activeSido: string | null;
  activeRegion: string | null;
  activeDistrict: string | null;
  sidoSummary: Map<string, RegionSummary>;
  regionSummary: Map<string, RegionSummary>;
  districtSummary: Map<string, RegionSummary>;
  onSelectSido: (sido: string | null) => void;
  onSelectRegion: (label: string | null) => void;
  onSelectDistrict: (district: string | null) => void;
}

export default function KoreaMap({
  sidoGeo, sigunguGeo, districtGeo, stations,
  activeSido, activeRegion, activeDistrict,
  sidoSummary, regionSummary, districtSummary,
  onSelectSido, onSelectRegion, onSelectDistrict,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tf, setTf] = useState<Transform>(IDENTITY);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number; panning: boolean } | null>(null);
  /** 방금 지도를 끌었으면 이어지는 click을 삼킨다. 끌다 놓은 곳이 선택되면 안 된다. */
  const suppressClick = useRef(false);

  const source = useMemo(() => tileSource(), []);

  /**
   * 어떤 레이어를 그릴지 정한다.
   *
   * 더 내려갈 곳이 없는 지역을 고르면 상세 단계로 간다.
   */
  const view = useMemo(() => {
    const has = (s?: RegionSummary) => !!s && s.total > 0;

    if (activeSido == null) {
      return {
        level: "sido" as const,
        features: sidoGeo.features.filter((f) => has(sidoSummary.get(f.properties.sido))),
        backdrop: [] as GeoFeature[],
        leaf: null as GeoFeature | null,
      };
    }

    const sigunguOfSido = sigunguGeo.features.filter((f) => f.properties.sido === activeSido);

    if (activeRegion) {
      const cityFeature = sigunguOfSido.find((f) => f.properties.label === activeRegion);
      const districts = districtGeo.features.filter(
        (f) => f.properties.sido === activeSido && f.properties.city === activeRegion,
      );

      if (districts.length > 0) {
        // 구를 고르면 상세, 아니면 구 목록을 보여준다.
        if (activeDistrict) {
          const leaf = districts.find((f) => f.properties.district === activeDistrict);
          if (leaf) {
            return { level: "detail" as const, features: [leaf], backdrop: [], leaf };
          }
        }
        return {
          level: "district" as const,
          features: districts.filter((f) =>
            has(districtSummary.get(`${activeSido}|${activeRegion}|${f.properties.district}`)),
          ),
          backdrop: cityFeature ? [cityFeature] : [],
          leaf: null,
        };
      }

      // 일반구가 없는 시·군·구는 여기가 마지막 단계다.
      if (cityFeature) {
        return { level: "detail" as const, features: [cityFeature], backdrop: [], leaf: cityFeature };
      }
    }

    const sidoFeature = sidoGeo.features.find((f) => f.properties.sido === activeSido);
    return {
      level: "sigungu" as const,
      features: sigunguOfSido.filter((f) =>
        has(regionSummary.get(`${f.properties.sido}|${f.properties.label}`)),
      ),
      backdrop: sidoFeature ? [sidoFeature] : [],
      leaf: null,
    };
  }, [sidoGeo, sigunguGeo, districtGeo, activeSido, activeRegion, activeDistrict,
      sidoSummary, regionSummary, districtSummary]);

  const isDetail = view.level === "detail";

  /**
   * 투영은 배경(상위 행정구역)에 맞춘다.
   * 표시되는 지역만으로 맞추면 착한주유소가 드문 시·도에서 조각들이 화면 가득
   * 확대되어 실제 위치를 알아볼 수 없다.
   */
  const { path, projection } = useMemo(() => {
    const fitTarget = view.backdrop.length > 0 ? view.backdrop : view.features;
    const p = geoMercator();
    if (fitTarget.length > 0) {
      // 상세 단계는 여백을 조금 더 둬서 핀 라벨이 잘리지 않게 한다.
      const pad = isDetail ? 54 : 26;
      p.fitExtent(
        [[pad, pad], [WIDTH - pad, HEIGHT - pad]],
        { type: "FeatureCollection", features: fitTarget } as unknown as GeoPermissibleObjects,
      );
    }
    return { path: geoPath(p), projection: p };
  }, [view, isDetail]);

  // ── 지역별 정보 ─────────────────────────────────────────────────────
  function keyOf(f: GeoFeature): string {
    if (view.level === "sido") return f.properties.sido;
    if (view.level === "district" || isDetail) {
      return f.properties.district
        ? `${f.properties.sido}|${f.properties.city}|${f.properties.district}`
        : `${f.properties.sido}|${f.properties.label}`;
    }
    return `${f.properties.sido}|${f.properties.label}`;
  }

  function summaryFor(f: GeoFeature): RegionSummary | undefined {
    if (view.level === "sido") return sidoSummary.get(f.properties.sido);
    if (f.properties.district) {
      return districtSummary.get(`${f.properties.sido}|${f.properties.city}|${f.properties.district}`);
    }
    return regionSummary.get(`${f.properties.sido}|${f.properties.label}`);
  }

  function nameOf(f: GeoFeature): string {
    if (view.level === "sido") return f.properties.sido;
    return f.properties.district ?? f.properties.label;
  }

  function tooltipFor(f: GeoFeature): string {
    const s = summaryFor(f);
    if (!s) return nameOf(f);
    return `${nameOf(f)} · ${s.total}곳 (🟢${s.green} 🟡${s.yellow} 🔴${s.red}${s.unknown ? ` ⚪${s.unknown}` : ""})`;
  }

  /** 상세 단계에서 찍을 주유소 — 좌표가 있는 것만 */
  const detailStations = useMemo(() => {
    if (!isDetail || !view.leaf) return { pinned: [] as StationSignal[], missing: 0 };
    const f = view.leaf;

    const inRegion = f.properties.district
      ? stations.filter(
          (s) => s.sido === f.properties.sido && s.sigungu === f.properties.city
            && s.district === f.properties.district,
        )
      : stations.filter((s) => (f.properties.keys ?? [`${f.properties.sido}|${f.properties.label}`])
          .includes(s.regionKey));

    const pinned = inRegion.filter((s) => s.lat != null && s.lng != null);
    return { pinned, missing: inRegion.length - pinned.length };
  }, [isDetail, view.leaf, stations]);

  /** 배경 지도 타일 — 상세 단계에서만 */
  const tiles = useMemo(() => {
    if (!isDetail) return [];
    return visibleTiles(
      {
        project: (p) => projection(p) as [number, number] | null,
        invert: (p) => (projection.invert?.(p) ?? null) as [number, number] | null,
        scale: projection.scale(),
        k: tf.k, tx: tf.x, ty: tf.y, width: WIDTH, height: HEIGHT,
      },
      source,
    );
  }, [isDetail, projection, tf, source]);

  /**
   * 지역 신호등 배지 배치.
   *
   * 확대 배율에 따라 글자를 역으로 축소하므로 배지 크기도 k로 나눈다. 그래야
   * 확대할수록 배지가 상대적으로 작아지면서 겹침이 저절로 풀린다.
   */
  const labels = useMemo(() => {
    if (isDetail) return [];
    const k = tf.k;
    const nameFont = (view.level === "sido" ? 12.5 : 11) / k;
    const countsFont = 10 / k;

    const entries = view.features.map((f) => {
      const s = summaryFor(f);
      const name = nameOf(f);

      // MultiPolygon 중 가장 큰 조각의 외곽링을 대표로 삼는다.
      let bestRing: number[][] = [];
      let bestArea = -1;
      for (const poly of f.geometry.coordinates) {
        const outer = poly[0];
        if (!outer) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const projected: number[][] = [];
        for (const [lng, lat] of outer) {
          const pt = projection([lng, lat]);
          if (!pt) continue;
          projected.push(pt);
          if (pt[0] < minX) minX = pt[0];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[1] > maxY) maxY = pt[1];
        }
        const area = (maxX - minX) * (maxY - minY);
        if (area > bestArea && projected.length >= 3) { bestArea = area; bestRing = projected; }
      }

      const pole = poleOfInaccessibility(bestRing);
      const digits = s ? String(s.green).length + String(s.yellow).length + String(s.red).length : 3;
      const chip: Chip = {
        id: keyOf(f),
        anchor: { x: pole.x, y: pole.y },
        x: pole.x, y: pole.y,
        w: Math.max(name.length * nameFont, countsFont * (3 * 1.15 + digits * 0.62 + 2 * 0.7)) + 11 / k,
        h: 29 / k,
      };
      return { chip, name, summary: s };
    });

    const byId = new Map(relaxChips(entries.map((e) => e.chip), { w: WIDTH, h: HEIGHT }).map((c) => [c.id, c]));
    return entries.map((e) => ({ ...e, chip: byId.get(e.chip.id) ?? e.chip, nameFont, countsFont }));
  }, [view, projection, tf.k, isDetail, sidoSummary, regionSummary, districtSummary]);

  /** 주유소 핀 라벨 — 이름표가 서로 겹치지 않게 밀어낸다. */
  const pins = useMemo(() => {
    if (!isDetail) return [];
    const k = tf.k;
    const font = 11 / k;

    const entries = detailStations.pinned.map((s) => {
      const pt = projection([s.lng!, s.lat!]);
      const anchor = { x: pt?.[0] ?? 0, y: pt?.[1] ?? 0 };
      return {
        station: s,
        anchor,
        chip: {
          id: String(s.seq),
          anchor,
          // 이름표는 핀 오른쪽 위에서 출발한다.
          x: anchor.x + (s.name.length * font) / 2 + 14 / k,
          y: anchor.y - 14 / k,
          w: s.name.length * font + 16 / k,
          h: 20 / k,
        } as Chip,
        font,
      };
    });

    const byId = new Map(relaxChips(entries.map((e) => e.chip), { w: WIDTH, h: HEIGHT }, 80).map((c) => [c.id, c]));
    return entries.map((e) => ({ ...e, chip: byId.get(e.chip.id) ?? e.chip }));
  }, [isDetail, detailStations, projection, tf.k]);

  // 드릴다운 단계가 바뀌면 확대/이동을 초기화한다.
  useEffect(() => { setTf(IDENTITY); }, [activeSido, activeRegion, activeDistrict, view.level]);

  // 휠 확대. React onWheel은 passive라 preventDefault가 먹지 않아 직접 붙인다.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = svg!.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
      const py = ((e.clientY - rect.top) / rect.height) * HEIGHT;
      setTf((prev) => {
        const k = clamp(prev.k * Math.exp(-e.deltaY * 0.0018), MIN_ZOOM, MAX_ZOOM);
        const ratio = k / prev.k;
        return { k, x: px - (px - prev.x) * ratio, y: py - (py - prev.y) * ratio };
      });
    }

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function zoomBy(factor: number) {
    setTf((prev) => {
      const k = clamp(prev.k * factor, MIN_ZOOM, MAX_ZOOM);
      const ratio = k / prev.k;
      return { k, x: WIDTH / 2 - (WIDTH / 2 - prev.x) * ratio, y: HEIGHT / 2 - (HEIGHT / 2 - prev.y) * ratio };
    });
  }

  // ── 드래그 이동 ──────────────────────────────────────────────────────
  //
  // 포인터 캡처는 실제로 끌기 시작한 뒤에만 건다.
  //
  // pointerdown에서 곧바로 setPointerCapture를 하면 이어지는 click 이벤트의
  // 타깃이 <path>가 아니라 캡처한 <svg>가 되어, 지역에 걸어둔 onClick이 아예
  // 호출되지 않는다. 그러면 지도를 눌러도 드릴다운이 되지 않는다.
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    drag.current = { sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, panning: false };
    suppressClick.current = false;
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;

    // 클릭할 때도 손이 1~3px은 움직인다. 그 정도로 지도가 끌려다니면
    // 지역을 고를 수가 없으므로 문턱을 넘어야 이동으로 친다.
    if (!d.panning) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return;
      d.panning = true;
      suppressClick.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - d.px) / rect.width) * WIDTH;
    const dy = ((e.clientY - d.py) / rect.height) * HEIGHT;
    d.px = e.clientX;
    d.py = e.clientY;
    setTf((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (drag.current?.panning && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
    setDragging(false);
  }

  function isSelected(f: GeoFeature): boolean {
    if (view.level === "district") return activeDistrict === f.properties.district;
    if (view.level === "sigungu") return activeRegion === f.properties.label;
    return false;
  }

  function handleClick(f: GeoFeature) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (isDetail) return;
    if (view.level === "sido") {
      onSelectSido(f.properties.sido);
      onSelectRegion(null);
      onSelectDistrict(null);
    } else if (view.level === "sigungu") {
      onSelectRegion(f.properties.label);
      onSelectDistrict(null);
    } else {
      onSelectDistrict(f.properties.district ?? null);
    }
  }

  const k = tf.k;

  return (
    <div className="map-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={`map-svg${dragging ? " is-dragging" : ""}`}
        role="img"
        aria-label={
          view.level === "sido" ? "전국 시·도 지도"
            : view.level === "sigungu" ? `${activeSido} 시·군·구 지도`
            : view.level === "district" ? `${activeRegion} 일반구 지도`
            : `${activeDistrict ?? activeRegion} 상세 지도`
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { drag.current = null; setDragging(false); setHover(null); }}
      >
        <g transform={`translate(${tf.x},${tf.y}) scale(${k})`}>
          {/* 배경 지도 타일 — 상세 단계에서만 */}
          {tiles.map((t) => (
            <image
              key={t.key} href={t.url}
              x={t.x} y={t.y} width={t.w} height={t.h}
              preserveAspectRatio="none"
              className="map-tile"
            />
          ))}

          {/* 상위 행정구역 외곽선 — 위치를 가늠하기 위한 배경. 클릭되지 않는다. */}
          {view.backdrop.map((f) => {
            const d = path(f as unknown as GeoPermissibleObjects);
            return d ? <path key={`bd-${f.properties.label}`} d={d} className="region-backdrop" /> : null;
          })}

          {view.features.map((f) => {
            const d = path(f as unknown as GeoPermissibleObjects);
            if (!d) return null;
            const s = summaryFor(f);
            return (
              <path
                key={keyOf(f)}
                d={d}
                className={`region${isSelected(f) ? " is-selected" : ""}${isDetail ? " is-detail" : ""}`}
                fill={isDetail ? "none" : s ? SIGNAL_COLORS[s.signal] : "var(--map-empty)"}
                onClick={() => handleClick(f)}
                onMouseMove={(e) => {
                  if (isDetail) return;
                  const rect = svgRef.current!.getBoundingClientRect();
                  setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: tooltipFor(f) });
                }}
              >
                {!isDetail && <title>{tooltipFor(f)}</title>}
              </path>
            );
          })}

          {/* 지시선 — 배지가 지역에서 밀려난 경우에만 */}
          {labels.map(({ chip }) => {
            const dist = Math.hypot(chip.x - chip.anchor.x, chip.y - chip.anchor.y);
            if (dist < 6 / k) return null;
            return (
              <line key={`ld-${chip.id}`} className="rl-leader"
                x1={chip.anchor.x} y1={chip.anchor.y} x2={chip.x} y2={chip.y} />
            );
          })}

          {labels.map(({ chip, name, summary, nameFont, countsFont }) => (
            <g key={`lb-${chip.id}`} className="region-label">
              <rect className="rl-chip"
                x={chip.x - chip.w / 2} y={chip.y - chip.h / 2}
                width={chip.w} height={chip.h} rx={5 / k} />
              <text className="rl-name" x={chip.x} y={chip.y - 5 / k}
                style={{ fontSize: `${nameFont}px` }}>{name}</text>
              {summary && (
                <text className="rl-counts" x={chip.x} y={chip.y + 8 / k}
                  style={{ fontSize: `${countsFont}px` }}>
                  <tspan fill={SIGNAL_COLORS.green}>●</tspan>
                  <tspan className="rl-num">{summary.green} </tspan>
                  <tspan fill={SIGNAL_COLORS.yellow}>●</tspan>
                  <tspan className="rl-num">{summary.yellow} </tspan>
                  <tspan fill={SIGNAL_COLORS.red}>●</tspan>
                  <tspan className="rl-num">{summary.red}</tspan>
                </text>
              )}
            </g>
          ))}

          {/* 주유소 핀 — 상세 단계에서만 */}
          {pins.map(({ chip, anchor }) => (
            <line key={`pl-${chip.id}`} className="pin-leader"
              x1={anchor.x} y1={anchor.y} x2={chip.x} y2={chip.y + chip.h / 2} />
          ))}

          {pins.map(({ station, anchor, chip, font }) => {
            const color = SIGNAL_COLORS[station.signal];
            const tip = `${station.name} · 휘발유 ${formatPrice(station.prices.gasoline)}`
              + ` / 경유 ${formatPrice(station.prices.diesel)}`
              + (station.priceIndex == null ? "" : ` · 계수 ${station.priceIndex.coefficient.toFixed(3)}`)
              + (station.regionRank == null ? "" : ` · 시·도 ${station.regionRank}위`);
            return (
              <g key={`pin-${station.seq}`} className="pin">
                <rect className="pin-chip"
                  x={chip.x - chip.w / 2} y={chip.y - chip.h / 2}
                  width={chip.w} height={chip.h} rx={4 / k}
                  stroke={color} />
                <text className="pin-name" x={chip.x} y={chip.y}
                  style={{ fontSize: `${font}px` }} fill={color}>
                  {station.name}
                </text>
                <circle className="pin-dot" cx={anchor.x} cy={anchor.y} r={6 / k} fill={color} />
                <circle
                  cx={anchor.x} cy={anchor.y} r={11 / k}
                  fill="transparent" className="pin-hit"
                  onMouseMove={(e) => {
                    const rect = svgRef.current!.getBoundingClientRect();
                    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: tip });
                  }}
                >
                  <title>{tip}</title>
                </circle>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="map-zoom" role="group" aria-label="지도 확대 축소">
        <button onClick={() => zoomBy(1.5)} aria-label="확대" title="확대">＋</button>
        <button onClick={() => zoomBy(1 / 1.5)} aria-label="축소" title="축소">－</button>
        <button onClick={() => setTf(IDENTITY)}
          disabled={k === 1 && tf.x === 0 && tf.y === 0}
          aria-label="초기화" title="초기화">⟲</button>
      </div>

      {k > 1 && <div className="map-zoom-level">{k.toFixed(1)}×</div>}

      {isDetail && (
        <div className="map-credit">
          {source.attribution}
          {detailStations.missing > 0 && (
            <span className="map-missing"> · 좌표 없어 표시 못한 곳 {detailStations.missing}</span>
          )}
        </div>
      )}

      {view.features.length === 0 && (
        <p className="map-none">이 지역에는 착한주유소가 없습니다.</p>
      )}

      {/* 지도는 떴는데 핀이 하나도 없으면 이유를 밝혀준다. 좌표가 비어 있을 뿐
          주유소가 없는 것은 아니다. 오른쪽 목록에는 그대로 나온다. */}
      {isDetail && pins.length === 0 && detailStations.missing > 0 && (
        <div className="map-nopins">
          <strong>착한주유소 {detailStations.missing}곳의 좌표가 없어 핀을 찍지 못했습니다.</strong>
          <span>가격과 신호등은 오른쪽 목록에서 확인할 수 있습니다.</span>
          <code>npm run coords</code>
        </div>
      )}

      {hover && (
        <div className="map-tip" style={{ left: `${hover.x}px`, top: `${hover.y}px` }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
