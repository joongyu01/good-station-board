import { useEffect, useMemo, useState } from "react";
import Admin from "./components/Admin.tsx";
import KoreaMap from "./components/KoreaMap.tsx";
import StationTable from "./components/StationTable.tsx";
import PriceChart from "./components/PriceChart.tsx";
import MobileSheet from "./components/MobileSheet.tsx";
import RankWindow from "./components/RankWindow.tsx";
import SplitLayout from "./components/SplitLayout.tsx";
import { csvName, downloadCsv, sortStations, type SortState } from "./lib/table.ts";
import { useNarrow } from "./lib/useNarrow.ts";
import {
  applyMode, dataUrl, formatCollectedAt, formatDate, groupByRegion, summarize,
  SIGNAL_COLORS, SIGNAL_LABELS, sidoLabel, VIEW_MODES, VIEW_MODE_LABELS,
  type BoardData, type GeoCollection, type RegionSummary, type SignalColor,
  type StationSignal, type ViewMode,
} from "./lib/board.ts";

/** 로고는 public/ 에 있어 번들 해시가 붙지 않는다. base 경로를 붙여 쓴다. */
const LOGO = new URL("logo.png", document.baseURI).toString();

const EMPTY_GEO: GeoCollection = { type: "FeatureCollection", features: [] };

/** 모바일 본문에 미리 보여줄 카드 수. 나머지는 전체화면에서 본다. */
const PREVIEW_ROWS = 5;

export default function App() {
  // 정적 사이트라 라우터를 두지 않고 해시만 본다. #/admin 이면 관리 화면.
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const [board, setBoard] = useState<BoardData | null>(null);
  const [sidoGeo, setSidoGeo] = useState<GeoCollection | null>(null);
  const [sigunguGeo, setSigunguGeo] = useState<GeoCollection | null>(null);
  const [districtGeo, setDistrictGeo] = useState<GeoCollection>(EMPTY_GEO);
  const [error, setError] = useState<string | null>(null);

  /** 판매가 추이 창을 띄운 주유소. null 이면 닫힘 */
  const [chartOf, setChartOf] = useState<StationSignal | null>(null);
  /** 판정 기준 — 통합(휘발유+경유) / 휘발유 / 경유 */
  const [mode, setMode] = useState<ViewMode>("sum");
  /** 표 정렬. null 이면 화면마다 정해둔 기본 순서를 그대로 쓴다. */
  const [sort, setSort] = useState<SortState | null>(null);
  /** 요약 띠에서 고른 판정. null 이면 전체를 보여준다. */
  const [filter, setFilter] = useState<SignalColor | null>(null);
  /** 계수 검증용 순위표 창 */
  const [rankOpen, setRankOpen] = useState(false);
  /** 로고를 눌러 초기화할 때마다 올린다. 지도가 확대·이동을 되돌리는 신호. */
  const [resetSignal, setResetSignal] = useState(0);

  /**
   * 모바일에서 지도를 전체화면으로 띄웠는지.
   *
   * 좁은 화면에서는 지도가 페이지 스크롤과 다툰다. 지도는 손가락 끌기를
   * 이동으로 먹어야 하고(`touch-action: none`) 페이지는 같은 동작으로
   * 스크롤해야 하니 둘 중 하나는 반드시 진다.
   *
   * 그래서 목록 안의 지도는 **보기만 하는 그림**으로 두고(포인터 이벤트를
   * 꺼서 끌면 페이지가 스크롤된다), 누르면 전체화면으로 열어 거기서만
   * 확대·이동·드릴다운을 하게 한다.
   */
  const narrow = useNarrow();
  const [mapOpen, setMapOpen] = useState(false);
  /** 목록도 같은 이유로 전체화면으로 뺀다. 472개 카드가 페이지 안에서 또 스크롤되면 손이 꼬인다. */
  const [listOpen, setListOpen] = useState(false);

  // 화면이 넓어지면 전체화면은 의미가 없다. PC 로 돌아가면 닫는다.
  useEffect(() => { if (!narrow) { setMapOpen(false); setListOpen(false); } }, [narrow]);

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

  // 판정은 주유소 단위다. 한 주유소에 신호등 하나.
  //
  // 다만 기준은 셋이다 — 휘발유+경유 합산이 기본이고, 유종 하나만 놓고 볼 수도
  // 있다. 세 기준의 성적은 집계 단계가 미리 다 계산해 두었고, 여기서는 고른
  // 것을 최상위로 끌어올리기만 한다.
  const stations = useMemo(
    () => applyMode(board?.stations ?? [], mode),
    [board, mode],
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
        stations: [...list].sort((a, b) => (a.regionRank ?? 1e9) - (b.regionRank ?? 1e9)),
        showRegion: false,
        scope: `${activeRegion} ${activeDistrict}`,
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
        stations: [...list].sort((a, b) => (a.regionRank ?? 1e9) - (b.regionRank ?? 1e9)),
        showRegion: (f?.properties.units?.length ?? 1) > 1,
        scope: `${sidoLabel(activeSido)} ${activeRegion}`,
        empty: "이 지역에는 착한주유소가 없습니다.",
      };
    }

    if (activeSido) {
      const list = stations.filter((s) => s.sido === activeSido);
      return {
        title: sidoLabel(activeSido),
        subtitle: `착한주유소 ${list.length}곳 · 지도에서 시·군·구를 누르면 좁혀집니다`,
        stations: [...list].sort((a, b) => (b.regionRank ?? -1) - (a.regionRank ?? -1)),
        showRegion: true,
        scope: sidoLabel(activeSido),
        empty: "이 시·도에는 착한주유소가 없습니다.",
      };
    }

    // 전국 보기 — 명단 전체를 계수 오름차순으로. 위쪽이 상위권이다.
    const all = [...stations].sort(
      (a, b) => (a.priceIndex?.coefficient ?? Infinity) - (b.priceIndex?.coefficient ?? Infinity),
    );
    return {
      title: "전국 착한주유소 리스트",
      subtitle: `${all.length}곳 · ${VIEW_MODE_LABELS[mode]} 계수가 낮은 순 (1.000 이하가 상위권)`,
      stations: all,
      showRegion: true,
      scope: "전국",
      empty: "표시할 착한주유소가 없습니다.",
    };
  }, [activeSido, activeRegion, activeDistrict, sigunguGeo, districtGeo, byRegion, stations, mode]);

  /**
   * 요약 띠에서 고른 판정으로 한 번 더 거른다.
   *
   * 지역 드릴다운 **위에** 얹는다. 경북을 고른 상태에서 '가격기준 초과' 를
   * 누르면 경북의 초과 건만 남는다.
   */
  const view = useMemo(() => {
    if (!filter) return panel;
    const list = panel.stations.filter((s) => s.signal === filter);
    return {
      ...panel,
      stations: list,
      title: `${panel.title} · ${SIGNAL_LABELS[filter]}`,
      subtitle: `${list.length}곳 · ${SIGNAL_LABELS[filter]}만 보는 중 (다시 누르면 전체)`,
      scope: `${panel.scope}_${SIGNAL_LABELS[filter]}`,
      empty: `${SIGNAL_LABELS[filter]}인 착한주유소가 없습니다.`,
    };
  }, [panel, filter]);

  const totals = useMemo(() => summarize(stations, "전국", ""), [stations]);

  /** 기관 로고를 누르면 처음 화면으로 — 드릴다운·확대·정렬을 모두 되돌린다. */
  function resetAll() {
    setActiveSido(null);
    setActiveRegion(null);
    setActiveDistrict(null);
    setChartOf(null);
    setSort(null);
    setFilter(null);
    setRankOpen(false);
    setMode("sum");
    setMapOpen(false);
    setListOpen(false);
    // 이미 전국 보기면 드릴다운 상태가 안 바뀌어 지도가 스스로 초기화하지
    // 않는다. 확대만 걸려 있는 경우를 위해 따로 신호를 준다.
    setResetSignal((n) => n + 1);
  }

  /** 표에 보이는 순서 그대로. CSV 도 이 배열을 쓴다. */
  const rows = useMemo(() => sortStations(view.stations, sort), [view.stations, sort]);

  if (hash.startsWith("#/admin")) {
    return <Admin onExit={() => { window.location.hash = ""; }} />;
  }

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

  const mapNode = (
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
      onSelectStation={setChartOf}
      resetSignal={resetSignal}
    />
  );

  /** 드릴다운 경로. 목록 위와 전체화면 지도 머리에 같이 쓴다. */
  const crumbs = (
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
  );

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="topbar-logo"
          onClick={resetAll}
          title="처음 화면으로 (드릴다운·확대·정렬 초기화)"
        >
          <img src={LOGO} alt="한국석유관리원 — 처음 화면으로" />
        </button>

        <div className="brand">
          <h1>착한주유소 현황판</h1>
        </div>

        <div className="meta">
          <span className="date">{formatDate(board.date)} 판매가</span>
          <span className="sep">·</span>
          <span
            className="collected"
            title="집계가 실행된 한국시간. 매일 10:20 · 19:30 KST 에 자동 수집합니다."
          >
            {formatCollectedAt(board.generatedAt)} 자동 수집 데이터 기준
          </span>
          <span className="sep">·</span>
          <span className="matched">{board.summary.matched}/{board.summary.total}곳 가격 연계</span>
        </div>

        <div className="mode-tabs" role="tablist" aria-label="판정 기준">
          {VIEW_MODES.map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "is-active" : ""}
              title={m === "sum"
                ? "휘발유+경유 합계로 판정"
                : `${VIEW_MODE_LABELS[m]} 가격만으로 판정`}
              onClick={() => setMode(m)}
            >
              {VIEW_MODE_LABELS[m]}
            </button>
          ))}
        </div>

        <a className="admin-link" href="#/admin" title="명단 관리">관리</a>
      </header>

      <div className="page">
      <div className="summary-strip">
        {(["green", "yellow", "red", "unknown", "stale"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`stat stat-${k}${filter === k ? " is-on" : ""}`}
            aria-pressed={filter === k}
            title={filter === k ? "눌러서 전체 보기" : `${SIGNAL_LABELS[k]} 만 보기`}
            onClick={() => setFilter(filter === k ? null : k)}
          >
            <span className="dot" style={{ background: SIGNAL_COLORS[k] }} />
            <span className="stat-label">{SIGNAL_LABELS[k]}</span>
            <strong className="stat-value">{totals[k]}</strong>
          </button>
        ))}
        <div className="stat stat-note">
          <strong>{mode === "sum" ? "휘발유+경유 합산" : `${VIEW_MODE_LABELS[mode]} 단독`}</strong>
          {" "}시·도 순위 기준 · 서울·경기 10위, 그 외 5위 이내는 상위권
        </div>
      </div>

      <SplitLayout
        left={<>
          {crumbs}

          {narrow ? (
            mapOpen ? (
              // 전체화면으로 옮겨 갔으므로 자리만 지킨다. 여기서도 그리면
              // 지도 두 벌이 각자 타일을 받아온다.
              <div className="map-placeholder">
                <span>지도를 전체화면으로 보는 중</span>
                <button type="button" className="btn" onClick={() => setMapOpen(false)}>
                  닫기
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="map-preview"
                onClick={() => setMapOpen(true)}
                aria-label="지도 전체화면으로 보기"
              >
                {mapNode}
                <span className="map-preview-hint">눌러서 지도 보기</span>
              </button>
            )
          ) : mapNode}

        </>}
        right={<>
          <div className="panel-head">
            <div className="panel-title">
              <h2>{view.title}</h2>
              <p className="panel-sub">{view.subtitle}</p>
            </div>
            <div className="panel-actions">
              <button
                type="button"
                className="btn-csv"
                disabled={rows.length === 0}
                title="지금 보이는 목록을 보이는 순서 그대로 내려받습니다"
                onClick={() => downloadCsv(rows, csvName(`${view.scope}_${VIEW_MODE_LABELS[mode]}`, board.date))}
              >
                CSV 내려받기
              </button>
              <button
                type="button"
                className="btn-rank"
                title="그날 그 시·도의 순위를 펼쳐 계수가 맞는지 확인합니다"
                onClick={() => setRankOpen(true)}
              >
                순위표 검증
              </button>
            </div>
          </div>
          <div className="panel-body">
            {narrow ? (
              listOpen ? (
                <div className="map-placeholder">
                  <span>목록을 전체화면으로 보는 중</span>
                  <button type="button" className="btn" onClick={() => setListOpen(false)}>닫기</button>
                </div>
              ) : (
                <>
                  <StationTable
                    stations={rows.slice(0, PREVIEW_ROWS)}
                    showRegion={view.showRegion}
                    emptyText={view.empty}
                    onSelect={setChartOf}
                    sort={sort}
                    onSort={setSort}
                    mode={mode}
                    compact
                  />
                  {rows.length > 0 && (
                    <button type="button" className="panel-more" onClick={() => setListOpen(true)}>
                      {rows.length.toLocaleString("ko-KR")}곳 전체 보기
                    </button>
                  )}
                </>
              )
            ) : (
              <StationTable
                stations={rows}
                showRegion={view.showRegion}
                emptyText={view.empty}
                onSelect={setChartOf}
                sort={sort}
                onSort={setSort}
                mode={mode}
              />
            )}
          </div>
        </>}
      />

      {narrow && mapOpen && (
        <MobileSheet
          label="지도"
          head={crumbs}
          onClose={() => setMapOpen(false)}
          foot={<>
            <span>{view.title} · {view.stations.length}곳</span>
            <button type="button" className="btn" onClick={() => setMapOpen(false)}>목록 보기</button>
          </>}
        >
          {mapNode}
        </MobileSheet>
      )}

      {narrow && listOpen && (
        <MobileSheet
          scroll
          label="착한주유소 목록"
          head={<>
            <h2 className="sheet-title">{view.title}</h2>
            <p className="panel-sub">{view.subtitle}</p>
          </>}
          onClose={() => setListOpen(false)}
          foot={
            <button
              type="button"
              className="btn-csv"
              disabled={rows.length === 0}
              onClick={() => downloadCsv(rows, csvName(`${view.scope}_${VIEW_MODE_LABELS[mode]}`, board.date))}
            >
              CSV 내려받기
            </button>
          }
        >
          <StationTable
            stations={rows}
            showRegion={view.showRegion}
            emptyText={view.empty}
            onSelect={setChartOf}
            sort={sort}
            onSort={setSort}
            mode={mode}
          />
        </MobileSheet>
      )}

      {rankOpen && (
        <RankWindow
          date={board.date}
          sido={activeSido}
          mode={mode}
          onClose={() => setRankOpen(false)}
        />
      )}

      {chartOf && <PriceChart station={chartOf} onClose={() => setChartOf(null)} />}

      {/* kpetrosafety 와 동일한 표기를 유지한다 */}
      <div className="copyright">
        © 2026 Korea Petroleum Quality &amp; Distribution Authority.
        <div className="cr-sub">Developed by Joongyu Shin.</div>
      </div>
      </div>
    </>
  );
}
