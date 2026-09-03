import { useEffect, useMemo, useState } from "react";
import KoreaMap from "./components/KoreaMap.tsx";
import StationTable from "./components/StationTable.tsx";
import {
  dataUrl, formatDate, groupByRegion, summarize,
  SIGNAL_COLORS, SIGNAL_LABELS, sidoLabel,
  type BoardData, type FuelType, type GeoCollection, type RegionSummary, type StationSignal,
} from "./lib/board.ts";
import { FUEL_LABELS, FUEL_TYPES } from "@shared/lib/types.ts";

const EMPTY_GEO: GeoCollection = { type: "FeatureCollection", features: [] };

export default function App() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [sidoGeo, setSidoGeo] = useState<GeoCollection | null>(null);
  const [sigunguGeo, setSigunguGeo] = useState<GeoCollection | null>(null);
  const [districtGeo, setDistrictGeo] = useState<GeoCollection>(EMPTY_GEO);
  const [error, setError] = useState<string | null>(null);

  const [fuel, setFuel] = useState<FuelType>("gasoline");
  const [activeSido, setActiveSido] = useState<string | null>(null);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [activeDistrict, setActiveDistrict] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(dataUrl("latest.json")).then((r) => r.json()),
      fetch(dataUrl("geo-sido.json")).then((r) => r.json()),
      fetch(dataUrl("geo-sigungu.json")).then((r) => r.json()),
      // 일반구 레이어는 없어도 동작한다. 구 단계만 사라진다.
      fetch(dataUrl("geo-district.json")).then((r) => r.json()).catch(() => EMPTY_GEO),
    ])
      .then(([b, s, g, d]) => {
        setBoard(b); setSidoGeo(s); setSigunguGeo(g); setDistrictGeo(d ?? EMPTY_GEO);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const stations = useMemo(
    () => board?.stations.filter((s) => s.fuelType === fuel) ?? [],
    [board, fuel],
  );

  const byRegion = useMemo(() => groupByRegion(stations), [stations]);

  /** 시·도 단위 집계 */
  const sidoSummary = useMemo(() => {
    const bySido = new Map<string, StationSignal[]>();
    for (const s of stations) {
      const arr = bySido.get(s.sido);
      if (arr) arr.push(s); else bySido.set(s.sido, [s]);
    }
    const out = new Map<string, RegionSummary>();
    for (const [sido, list] of bySido) out.set(sido, summarize(list, sidoLabel(sido), sido));
    return out;
  }, [stations]);

  /**
   * 지도 폴리곤 단위 집계.
   * 폴리곤 하나가 여러 현행 시·군·구를 대표할 수 있어(인천 검단구·서해구 등)
   * properties.keys 를 모두 합산한다.
   */
  const regionSummary = useMemo(() => {
    const out = new Map<string, RegionSummary>();
    if (!sigunguGeo) return out;
    for (const f of sigunguGeo.features) {
      const keys = f.properties.keys ?? [`${f.properties.sido}|${f.properties.label}`];
      const list = keys.flatMap((k) => byRegion.get(k) ?? []);
      out.set(
        `${f.properties.sido}|${f.properties.label}`,
        summarize(list, f.properties.label, f.properties.sido),
      );
    }
    return out;
  }, [sigunguGeo, byRegion]);

  /** 일반구 단위 집계 — 키는 `시도|시|구` */
  const districtSummary = useMemo(() => {
    const groups = new Map<string, StationSignal[]>();
    for (const s of stations) {
      if (!s.district) continue;
      const key = `${s.sido}|${s.sigungu}|${s.district}`;
      const arr = groups.get(key);
      if (arr) arr.push(s); else groups.set(key, [s]);
    }
    const out = new Map<string, RegionSummary>();
    for (const [key, list] of groups) {
      out.set(key, summarize(list, list[0].district!, list[0].sido));
    }
    return out;
  }, [stations]);

  /** 시·군·구 폴리곤이 대표하는 현행 단위들의 주유소 */
  function stationsOfRegion(sido: string, label: string): StationSignal[] {
    const f = sigunguGeo?.features.find(
      (x) => x.properties.sido === sido && x.properties.label === label,
    );
    const keys = f?.properties.keys ?? [`${sido}|${label}`];
    return keys.flatMap((k) => byRegion.get(k) ?? []);
  }

  /** 오른쪽 패널 내용 */
  const panel = useMemo(() => {
    if (activeSido && activeRegion && activeDistrict) {
      const list = stations.filter(
        (s) => s.sido === activeSido && s.sigungu === activeRegion && s.district === activeDistrict,
      );
      return {
        title: activeDistrict,
        subtitle: `${activeRegion} · 착한주유소 ${list.length}곳`,
        stations: [...list].sort((a, b) => (a.gapFromMin ?? 1e9) - (b.gapFromMin ?? 1e9)),
        showRegion: false,
        empty: "이 구에는 착한주유소가 없습니다.",
      };
    }

    if (activeSido && activeRegion) {
      const list = stationsOfRegion(activeSido, activeRegion);
      const f = sigunguGeo?.features.find(
        (x) => x.properties.sido === activeSido && x.properties.label === activeRegion,
      );
      const hasDistricts = districtGeo.features.some(
        (x) => x.properties.sido === activeSido && x.properties.city === activeRegion,
      );
      return {
        title: activeRegion,
        subtitle: `${sidoLabel(activeSido)} · 착한주유소 ${list.length}곳`
          + (hasDistricts ? " · 지도에서 구를 누르면 더 좁혀집니다" : ""),
        stations: [...list].sort((a, b) => (a.gapFromMin ?? 1e9) - (b.gapFromMin ?? 1e9)),
        showRegion: (f?.properties.units?.length ?? 1) > 1,
        empty: "이 지역에는 착한주유소가 없습니다.",
      };
    }

    if (activeSido) {
      const list = stations.filter((s) => s.sido === activeSido);
      return {
        title: sidoLabel(activeSido),
        subtitle: `착한주유소 ${list.length}곳 · 지도에서 시·군·구를 누르면 좁혀집니다`,
        stations: [...list].sort((a, b) => (b.gapFromMin ?? -1) - (a.gapFromMin ?? -1)),
        showRegion: true,
        empty: "이 시·도에는 착한주유소가 없습니다.",
      };
    }

    // 전국 보기 — 지역 시세보다 비싼 곳부터. 현황판에서 먼저 봐야 할 대상이다.
    const reds = stations.filter((s) => s.signal === "red");
    const worst = [...reds].sort((a, b) => (b.gapFromMin ?? 0) - (a.gapFromMin ?? 0)).slice(0, 30);
    return {
      title: "점검 우선 대상",
      subtitle: `지역 최저가에 미달한 착한주유소 ${reds.length}곳 중 격차가 큰 ${worst.length}곳`,
      stations: worst,
      showRegion: true,
      empty: "지역 최저가에 미달한 착한주유소가 없습니다.",
    };
  }, [activeSido, activeRegion, activeDistrict, sigunguGeo, districtGeo, byRegion, stations]);

  const totals = useMemo(() => summarize(stations, "전국", ""), [stations]);

  if (error) {
    return (
      <div className="state-msg">
        <h1>데이터를 불러오지 못했습니다</h1>
        <p className="mono">{error}</p>
        <p><code>npm run collect &amp;&amp; npm run aggregate</code> 로 데이터를 만든 뒤 다시 열어주세요.</p>
      </div>
    );
  }

  if (!board || !sidoGeo || !sigunguGeo) {
    return <div className="state-msg"><p>불러오는 중…</p></div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>착한주유소 현황판</h1>
          <span className="org">한국석유관리원</span>
        </div>

        <div className="meta">
          <span className="date">{formatDate(board.date)} 판매가 기준</span>
          <span className="sep">·</span>
          <span className="matched">{board.summary.matched}/{board.summary.total}곳 가격 연계</span>
        </div>

        <div className="fuel-tabs" role="tablist" aria-label="유종 선택">
          {FUEL_TYPES.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={fuel === f}
              className={fuel === f ? "is-active" : ""}
              onClick={() => setFuel(f)}
            >
              {FUEL_LABELS[f]}
            </button>
          ))}
        </div>
      </header>

      <div className="summary-strip">
        {(["green", "yellow", "red", "unknown"] as const).map((k) => (
          <div key={k} className={`stat stat-${k}`}>
            <span className="dot" style={{ background: SIGNAL_COLORS[k] }} />
            <span className="stat-label">{SIGNAL_LABELS[k]}</span>
            <strong className="stat-value">{totals[k]}</strong>
          </div>
        ))}
        <div className="stat stat-note">
<strong>지역 최저가</strong> 기준 · 최저가 +20원 이내는 근접
        </div>
      </div>

      <main className="layout">
        <section className="map-col">
          <div className="breadcrumb">
            <button
              className={activeSido ? "crumb" : "crumb is-current"}
              onClick={() => { setActiveSido(null); setActiveRegion(null); setActiveDistrict(null); }}
            >
              전국
            </button>
            {activeSido && (
              <>
                <span className="crumb-sep">›</span>
                <button
                  className={activeRegion ? "crumb" : "crumb is-current"}
                  onClick={() => { setActiveRegion(null); setActiveDistrict(null); }}
                >
                  {sidoLabel(activeSido)}
                </button>
              </>
            )}
            {activeRegion && (
              <>
                <span className="crumb-sep">›</span>
                <button
                  className={activeDistrict ? "crumb" : "crumb is-current"}
                  onClick={() => setActiveDistrict(null)}
                >
                  {activeRegion}
                </button>
              </>
            )}
            {activeDistrict && (
              <>
                <span className="crumb-sep">›</span>
                <span className="crumb is-current">{activeDistrict}</span>
              </>
            )}
          </div>

          <KoreaMap
            sidoGeo={sidoGeo}
            sigunguGeo={sigunguGeo}
            districtGeo={districtGeo}
            stations={stations}
            activeSido={activeSido}
            activeRegion={activeRegion}
            activeDistrict={activeDistrict}
            sidoSummary={sidoSummary}
            regionSummary={regionSummary}
            districtSummary={districtSummary}
            onSelectSido={setActiveSido}
            onSelectRegion={setActiveRegion}
            onSelectDistrict={setActiveDistrict}
          />

          <p className="map-hint">
            {!activeSido && "시·도를 누르면 시·군·구 지도로 내려갑니다. 착한주유소가 없는 지역은 표시하지 않고 외곽선만 그립니다."}
            {activeSido && !activeRegion && "시·군·구를 누르면 실제 지도 위에 주유소 핀이 찍힙니다. 휠로 확대, 끌어서 이동."}
            {activeSido && activeRegion && "핀 색은 그 주유소의 신호등입니다. 휠로 확대, 끌어서 이동."}
          </p>
        </section>

        <section className="panel-col">
          <div className="panel-head">
            <h2>{panel.title}</h2>
            <p className="panel-sub">{panel.subtitle}</p>
          </div>
          <div className="panel-body">
            <StationTable
              stations={panel.stations}
              showRegion={panel.showRegion}
              emptyText={panel.empty}
            />
          </div>
        </section>
      </main>

      <footer className="foot">
        <span>가격 출처: 오피넷 사업자별 과거 판매가격 · 전국 주유소 대비 시·군·구 최저가로 판정</span>
        <span className="mono">생성 {new Date(board.generatedAt).toLocaleString("ko-KR")}</span>
      </footer>

      {/* kpetrosafety 와 동일한 표기를 유지한다 */}
      <div className="copyright">
        © 2026 Korea Petroleum Quality &amp; Distribution Authority.
        <div className="cr-sub">Developed by Joongyu Shin.</div>
      </div>
    </div>
  );
}
