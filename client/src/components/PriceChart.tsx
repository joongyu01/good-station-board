/**
 * 주유소 1곳의 판매가·계수 추이.
 *
 * 목록의 상호나 지도의 주유기 아이콘을 누르면 열린다. 왼쪽에 그래프 둘, 오른쪽에
 * 날짜별 가격 기록표를 나란히 놓는다.
 *
 * 그래프를 둘로 나눈 이유는 단위가 다르기 때문이다. 판매가는 1,700~2,000 대이고
 * 계수는 0.94~1.15 다. 한 그림에 이중축으로 얹으면 두 눈금을 번갈아 읽어야 하고,
 * 어느 선이 어느 축인지 매번 확인해야 한다. 칸을 분리하면 각자 자기 축만 갖는다.
 *
 * 두 그래프는 같은 x 눈금을 쓰고 좌우 여백도 같아서 세로로 정확히 포개진다.
 * 그래서 날짜 라벨은 아래쪽 그래프에만 붙인다.
 *
 * 계수 1.000 은 그날 그 시·도의 상위권 커트라인이다. 그 선을 점선으로 깔아 두면
 * 언제 기준을 넘나들었는지가 한눈에 읽힌다.
 */
import { useEffect, useMemo, useState } from "react";
import { COMPLIANCE_FROM, complianceOf, type History, type StationSeries } from "@shared/lib/history.ts";
import { SIGNAL_COLORS, dataUrl, formatPrice, type StationSignal } from "../lib/board.ts";
import { withBrand } from "@shared/lib/brand.ts";
import { useNarrow } from "../lib/useNarrow.ts";
import { COEF_DIGITS } from "@shared/lib/signal.ts";

/**
 * viewBox 너비. 모바일에서는 좁게 잡는다.
 *
 * SVG 가 `width:100%; height:auto` 라 화면에서의 높이는 **칸 너비 × H/W** 다.
 * 폭 340px 짜리 화면에 W=720 을 그대로 쓰면 판매가 그래프가 94px 로 납작해져
 * 선이 겹쳐 보인다. 좁은 화면에서는 W 를 줄여 세로 비율을 확보한다.
 */
const W_DESKTOP = 720;
const W_MOBILE = 400;
/**
 * 그래프 높이(viewBox 기준).
 *
 * SVG 는 `width:100%; height:auto` 라 실제 높이가 **칸 너비 × H/W** 로 정해진다.
 * 창 너비가 1180px 로 묶여 있으니 그래프 칸은 900px 언저리에서 더 넓어지지
 * 않고, 따라서 이 값이 곧 화면에서의 높이를 결정한다.
 *
 * 250/165 로 뒀더니 노트북 화면에서 창이 세로로 넘쳐 계수 그래프의 날짜
 * 라벨이 잘렸다. 높이 768px 짜리 화면에도 스크롤 없이 들어가도록 줄였다.
 */
const H_PRICE_DESKTOP = 200;
/** 모바일은 가로가 좁은 만큼 세로를 더 준다. */
const H_PRICE_MOBILE = 250;
/** 계수는 값의 폭이 좁아 판매가보다 낮아도 읽힌다. */
const H_COEF_DESKTOP = 140;
const H_COEF_MOBILE = 175;
const PAD = { top: 16, right: 16, bottom: 10, left: 58 };
/** 날짜 라벨이 들어가는 아래 여백 — 계수 그래프에만 적용한다. */
const PAD_BOTTOM_AXIS = 30;

/** 휘발유는 노란색. 경유의 초록과 계수의 빨강과 겹치지 않는다. */
const COLOR_GASOLINE = "#E3A81E";
const COLOR_DIESEL = "#5B9A3E";
const COLOR_COEF = "#C6402E";

/** 여러 창에서 같은 파일을 다시 받지 않도록 모듈 수준에 한 번만 담아 둔다. */
let cache: Promise<History> | null = null;
function loadHistory(): Promise<History> {
  if (!cache) {
    cache = fetch(dataUrl("history.json")).then((r) => {
      if (!r.ok) throw new Error(`history.json ${r.status}`);
      return r.json();
    });
    // 실패한 약속을 캐시에 남기면 다시 열어도 계속 실패한다.
    cache.catch(() => { cache = null; });
  }
  return cache;
}

interface Props {
  station: StationSignal;
  onClose: () => void;
}

export default function PriceChart({ station, onClose }: Props) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const narrow = useNarrow();
  /**
   * 조회 시작일. 기본은 8월 1일이고 끝은 늘 최신일이다.
   *
   * 한 달치면 꾸준했는지 보기에 충분하고, 두 달치를 다 그리면 최근 흐름이
   * 뭉개진다. 그 이전까지 보고 싶으면 '전체' 로 넓힌다.
   */
  const [from, setFrom] = useState<string>(COMPLIANCE_FROM);
  const W = narrow ? W_MOBILE : W_DESKTOP;
  const H_PRICE = narrow ? H_PRICE_MOBILE : H_PRICE_DESKTOP;
  const H_COEF = narrow ? H_COEF_MOBILE : H_COEF_DESKTOP;

  useEffect(() => {
    let alive = true;
    loadHistory()
      .then((h) => { if (alive) setHistory(h); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, []);

  // 배경을 눌러도 닫히지만 Esc 가 더 빠르다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const series: StationSeries | null =
    (station.stationId && history?.stations[station.stationId]) || null;

  const chart = useMemo(() => {
    if (!history || !series) return null;
    // 아래 헬퍼들이 중첩 함수라 history 의 null 좁히기가 풀린다. 한 번 묶어 둔다.
    const dates = history.dates;

    // 고른 구간 안에서, 값이 하나라도 있는 날만 그린다.
    // 앞뒤로 빈 날짜가 길면 선이 구석에 몰린다.
    const idx: number[] = [];
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] < from) continue;
      if (series.g[i] != null || series.d[i] != null || series.c[i] != null) idx.push(i);
    }
    if (idx.length === 0) return null;

    const prices = idx.flatMap((i) => [series.g[i], series.d[i]]).filter((v): v is number => v != null);
    const coefs = idx.map((i) => series.c[i]).filter((v): v is number => v != null);
    if (prices.length === 0 && coefs.length === 0) return null;

    // 가격축 — 위아래로 조금 띄운다. 딱 맞추면 선이 테두리에 닿는다.
    const pMin = prices.length ? Math.min(...prices) : 0;
    const pMax = prices.length ? Math.max(...prices) : 1;
    const pPad = Math.max(10, (pMax - pMin) * 0.15);
    const p0 = pMin - pPad;
    const p1 = pMax + pPad;

    // 계수축 — 1.000 을 반드시 포함시킨다. 커트라인이 화면 밖이면 점선이 안 보인다.
    const cMin = Math.min(1, ...(coefs.length ? coefs : [1]));
    const cMax = Math.max(1, ...(coefs.length ? coefs : [1]));
    const cPad = Math.max(0.008, (cMax - cMin) * 0.2);
    const c0 = cMin - cPad;
    const c1 = cMax + cPad;

    const innerW = W - PAD.left - PAD.right;
    const priceH = H_PRICE - PAD.top - PAD.bottom;
    const coefH = H_COEF - PAD.top - PAD_BOTTOM_AXIS;

    const x = (k: number) =>
      PAD.left + (idx.length === 1 ? innerW / 2 : (k / (idx.length - 1)) * innerW);
    const yP = (v: number) => PAD.top + priceH - ((v - p0) / (p1 - p0)) * priceH;
    const yC = (v: number) => PAD.top + coefH - ((v - c0) / (c1 - c0)) * coefH;

    /**
     * null 이 섞인 계열을 끊어진 선분들로 만든다.
     *
     * 값이 빈 날뿐 아니라 **날짜축 자체가 건너뛴 구간**에서도 끊는다. 아직 안
     * 받아온 기간을 직선으로 이으면 그동안 가격이 그대로였던 것처럼 보인다.
     * 실제로 7/12 다음이 9/2 인 상태에서 두 점을 이었더니 7주 내내 평평한
     * 그래프가 나왔다.
     */
    function line(values: (number | null)[], y: (v: number) => number): string[] {
      const segs: string[] = [];
      let cur: string[] = [];
      const flush = () => { if (cur.length > 1) segs.push(cur.join(" ")); cur = []; };

      idx.forEach((i, k) => {
        const v = values[i];
        if (v == null) { flush(); return; }
        if (k > 0 && gapDays(dates[idx[k - 1]], dates[i]) > 1) flush();
        cur.push(`${cur.length ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`);
      });
      flush();
      return segs;
    }

    /** 앞뒤가 모두 끊긴 외톨이 점은 선으로 안 보인다. 점으로 따로 찍는다. */
    function dots(values: (number | null)[], y: (v: number) => number) {
      const out: Array<{ x: number; y: number }> = [];
      const linked = (a: number, b: number) =>
        values[idx[a]] != null && values[idx[b]] != null
        && gapDays(dates[idx[a]], dates[idx[b]]) <= 1;
      idx.forEach((i, k) => {
        const v = values[i];
        if (v == null) return;
        const back = k > 0 && linked(k - 1, k);
        const fwd = k < idx.length - 1 && linked(k, k + 1);
        if (!back && !fwd) out.push({ x: x(k), y: y(v) });
      });
      return out;
    }

    // x축 눈금 — 6개 안팎으로 솎는다. 66일치 날짜를 다 쓰면 글자가 겹친다.
    const step = Math.max(1, Math.ceil(idx.length / 6));
    const ticks = idx
      .map((i, k) => ({ k, date: dates[i] }))
      .filter(({ k }) => k % step === 0 || k === idx.length - 1);

    const last = idx.at(-1)!;

    return {
      idx, x, yP, yC,
      gasoline: line(series.g, yP), diesel: line(series.d, yP), coef: line(series.c, yC),
      gasolineDots: dots(series.g, yP), dieselDots: dots(series.d, yP), coefDots: dots(series.c, yC),
      ticks,
      priceTicks: niceTicks(p0, p1, 4),
      coefTicks: niceTicks(c0, c1, 3),
      priceGridY: (v: number) => yP(v),
      cutoffY: c0 <= 1 && 1 <= c1 ? yC(1) : null,
      priceH, coefH,
      from: dates[idx[0]], to: dates[last],
      latest: { g: series.g[last], d: series.d[last], c: series.c[last] },
      // 오른쪽 기록표 — **최신 날짜가 위로**. 표를 열자마자 보고 싶은 것은
      // 오늘 가격이지 두 달 전 가격이 아니다. 그래프는 시간순 그대로 둔다.
      //
      // 그래프와 달리 **구간의 모든 날**을 넣는다. 값이 없는 날을 건너뛰면
      // 9/5·9/4 가 통째로 사라지고 9/3 부터 시작해, 신고를 거른 것인지 아직
      // 안 받아온 것인지 알 수가 없다. 빈 날은 '정보없음' 으로 적는다.
      rows: dates
        .map((date, i) => ({ date, g: series.g[i], d: series.d[i] }))
        .filter((r) => r.date >= from)
        .reverse(),
    };
  }, [history, series, from, W, H_PRICE, H_COEF]);

  /** 고른 구간의 적합·근접·초과 일수. */
  const days = useMemo(
    () => (history && station.stationId ? complianceOf(history, station.stationId, from) : null),
    [history, station.stationId, from],
  );

  /**
   * '전체' 버튼이 넓힐 수 있는 가장 이른 날.
   *
   * 판정이 저장된 날까지만이다. 가격은 있는데 판정이 없는 구간(시계열을 나중에
   * 확장하기 전에 받아둔 날들)까지 넓히면 그 날들이 전부 '가격정보 없음' 으로
   * 잡혀 일수가 틀리게 나온다. 기본 구간과 같아지면 버튼을 감춘다.
   */
  const earliest = useMemo(() => {
    if (!history) return COMPLIANCE_FROM;
    for (let i = 0; i < history.dates.length; i++) {
      const judged = Object.values(history.stations).some((x) => x.s?.[i] != null);
      if (judged) return history.dates[i];
    }
    return COMPLIANCE_FROM;
  }, [history]);

  /** 고를 수 있는 구간. 판정이 8월부터만 있으면 '전체' 는 뜻이 없어 감춘다. */
  const ranges: Array<[string, string]> = [[COMPLIANCE_FROM, "8월 1일부터"]];
  if (earliest < COMPLIANCE_FROM) ranges.push([earliest, "전체"]);

  return (
    <div className="chart-backdrop" onClick={onClose} role="presentation">
      <div
        className="chart-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${station.name} 판매가 추이`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="chart-head">
          <div>
            <h3>
              <span className="dot" style={{ background: SIGNAL_COLORS[station.signal] }} />
              {withBrand(station.name, station.brand)}
            </h3>
            <p className="chart-sub">
              {station.sido} {station.sigungu}
              {station.isSelf && <span className="badge badge-self">셀프</span>}
              {chart && <> · {fmtDate(chart.from)} ~ {fmtDate(chart.to)}</>}
            </p>
          </div>
          <button className="chart-close" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        {days && (
          <div className="chart-days">
            <div className="chart-range" role="group" aria-label="조회 구간">
              {ranges.map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  className={from === v ? "is-active" : ""}
                  onClick={() => setFrom(v)}
                >
                  {label}
                </button>
              ))}
            </div>

            <ul className="days-list">
              <li className="d-g"><b>{days.greenDays}</b>일<span>가격기준 적합</span></li>
              <li className="d-y"><b>{days.yellowDays}</b>일<span>가격기준 근접</span></li>
              <li className="d-r"><b>{days.redDays}</b>일<span>가격기준 초과</span></li>
              {days.missingDays > 0 && (
                <li className="d-n"><b>{days.missingDays}</b>일<span>가격정보 없음</span></li>
              )}
            </ul>
          </div>
        )}

        <div className="chart-body">
          {error && (
            <p className="chart-msg">
              추이 데이터를 불러오지 못했습니다.<br />
              <code>npm run backfill</code> 로 과거치를 채워주세요.
            </p>
          )}
          {!error && !history && <p className="chart-msg">불러오는 중…</p>}
          {!error && history && !chart && (
            <p className="chart-msg">
              이 주유소의 과거 판매가 기록이 아직 없습니다.
              {!station.stationId && <><br />오피넷 주유소코드가 연결되지 않았습니다.</>}
            </p>
          )}

          {chart && (
            <div className="chart-split">
              <div className="chart-graphs">
                {/* ── 판매가 ─────────────────────────────────── */}
                <section className="chart-panel">
                  <h4 className="chart-panel-title">판매가 <span>원/L</span></h4>
                  <svg viewBox={`0 0 ${W} ${H_PRICE}`} className="chart-svg" role="img"
                    aria-label={`${station.name} 휘발유·경유 판매가 추이`}>
                    {chart.priceTicks.map((v) => (
                      <g key={`p${v}`}>
                        <line className="ch-grid" x1={PAD.left} x2={W - PAD.right}
                          y1={chart.yP(v)} y2={chart.yP(v)} />
                        <text className="ch-axis" x={PAD.left - 8} y={chart.yP(v)}
                          textAnchor="end" dominantBaseline="middle">
                          {Math.round(v).toLocaleString("ko-KR")}
                        </text>
                      </g>
                    ))}

                    {chart.gasoline.map((d, i) => (
                      <path key={`g${i}`} d={d} className="ch-line" stroke={COLOR_GASOLINE} />
                    ))}
                    {chart.diesel.map((d, i) => (
                      <path key={`d${i}`} d={d} className="ch-line" stroke={COLOR_DIESEL} />
                    ))}
                    {chart.gasolineDots.map((p, i) => (
                      <circle key={`gd${i}`} cx={p.x} cy={p.y} r={2.6} fill={COLOR_GASOLINE} />
                    ))}
                    {chart.dieselDots.map((p, i) => (
                      <circle key={`dd${i}`} cx={p.x} cy={p.y} r={2.6} fill={COLOR_DIESEL} />
                    ))}
                  </svg>
                  <p className="chart-legend">
                    <span><i style={{ background: COLOR_GASOLINE }} />휘발유 {formatPrice(chart.latest.g)}</span>
                    <span><i style={{ background: COLOR_DIESEL }} />경유 {formatPrice(chart.latest.d)}</span>
                  </p>
                </section>

                {/* ── 계수 ───────────────────────────────────── */}
                <section className="chart-panel">
                  <h4 className="chart-panel-title">
                    계수 <span>1 이하가 상위권</span>
                  </h4>
                  <svg viewBox={`0 0 ${W} ${H_COEF}`} className="chart-svg" role="img"
                    aria-label={`${station.name} 합산 계수 추이`}>
                    {chart.coefTicks.map((v) => (
                      <g key={`c${v}`}>
                        <line className="ch-grid" x1={PAD.left} x2={W - PAD.right}
                          y1={chart.yC(v)} y2={chart.yC(v)} />
                        <text className="ch-axis" x={PAD.left - 8} y={chart.yC(v)}
                          textAnchor="end" dominantBaseline="middle">{v.toFixed(COEF_DIGITS)}</text>
                      </g>
                    ))}

                    {chart.cutoffY != null && (
                      <>
                        <line className="ch-cutoff" x1={PAD.left} x2={W - PAD.right}
                          y1={chart.cutoffY} y2={chart.cutoffY} />
                        <text className="ch-cutoff-label" x={W - PAD.right - 4}
                          y={chart.cutoffY - 5} textAnchor="end">상위권 기준</text>
                      </>
                    )}

                    {/* 날짜 라벨은 아래 그래프에만. 두 그래프의 x 는 정확히 포개진다. */}
                    {chart.ticks.map(({ k, date }) => (
                      <text key={date} className="ch-axis" x={chart.x(k)}
                        y={H_COEF - PAD_BOTTOM_AXIS + 18} textAnchor="middle">{fmtTick(date)}</text>
                    ))}

                    {chart.coef.map((d, i) => (
                      <path key={`cl${i}`} d={d} className="ch-line" stroke={COLOR_COEF} />
                    ))}
                    {chart.coefDots.map((p, i) => (
                      <circle key={`cd${i}`} cx={p.x} cy={p.y} r={2.6} fill={COLOR_COEF} />
                    ))}
                  </svg>
                  <p className="chart-legend">
                    <span><i style={{ background: COLOR_COEF }} />
                      계수 {chart.latest.c?.toFixed(COEF_DIGITS) ?? "—"}</span>
                  </p>
                </section>
              </div>

              {/* ── 날짜별 기록 ──────────────────────────────── */}
              {/*
                안쪽 스크롤러를 절대 배치로 띄운다. 그냥 두면 67줄짜리 표가
                그리드 행 높이를 밀어 올려 창이 그래프보다 훨씬 길어진다.
              */}
              <div className="chart-log">
                <div className="chart-log-scroll">
                <table className="log-table">
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th className="num">휘발유</th>
                      <th className="num">경유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chart.rows.map((r) => (
                      <tr key={r.date} className={r.g == null && r.d == null ? "is-none" : ""}>
                        <th scope="row">{fmtTick(r.date)}</th>
                        {r.g == null && r.d == null ? (
                          <td className="no-data" colSpan={2}>정보없음</td>
                        ) : (
                          <>
                            <td className="num">{r.g == null ? "—" : r.g.toLocaleString("ko-KR")}</td>
                            <td className="num">{r.d == null ? "—" : r.d.toLocaleString("ko-KR")}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 축 눈금값을 보기 좋은 간격으로 고른다. */
function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    out.push(Math.round(v * 10 ** COEF_DIGITS) / 10 ** COEF_DIGITS);
  }
  return out;
}

/** 두 YYYYMMDD 사이의 일수. 1이면 바로 다음 날이다. */
function gapDays(a: string, b: string): number {
  const at = Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8));
  const bt = Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8));
  return Math.round((bt - at) / 86_400_000);
}

function fmtDate(d: string): string {
  return `${Number(d.slice(4, 6))}월 ${Number(d.slice(6, 8))}일`;
}

function fmtTick(d: string): string {
  return `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}`;
}
