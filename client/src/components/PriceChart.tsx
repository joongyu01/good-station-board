/**
 * 주유소 1곳의 판매가·계수 추이.
 *
 * 목록의 상호나 지도의 주유기 아이콘을 누르면 열린다. 왼쪽 축은 휘발유·경유
 * 판매가(원/L), 오른쪽 축은 합산 계수다. 계수는 빨간 선으로 그린다.
 *
 * 축을 둘로 나눈 이유는 단위가 다르기 때문이다. 판매가는 1,700~2,000 대이고
 * 계수는 0.94~1.15 라 한 축에 얹으면 계수 선이 바닥에 붙어 아무 변화도
 * 안 보인다.
 *
 * 계수 1.000 은 그날 그 시·도의 초록불 커트라인이다. 그 선을 점선으로 깔아
 * 두면 언제 기준을 넘나들었는지가 한눈에 읽힌다.
 */
import { useEffect, useMemo, useState } from "react";
import type { History, StationSeries } from "@shared/lib/history.ts";
import { SIGNAL_COLORS, dataUrl, formatPrice, type StationSignal } from "../lib/board.ts";
import { withBrand } from "@shared/lib/brand.ts";

const W = 720;
const H = 340;
const PAD = { top: 18, right: 58, bottom: 34, left: 56 };

const COLOR_GASOLINE = "#2F6FB5";
const COLOR_DIESEL = "#5B9A3E";
/** 계수는 빨간색으로 — 요구사항 그대로다. */
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

    // 값이 하나라도 있는 구간만 그린다. 앞뒤로 빈 날짜가 길면 선이 구석에 몰린다.
    const idx: number[] = [];
    for (let i = 0; i < history.dates.length; i++) {
      if (series.g[i] != null || series.d[i] != null || series.c[i] != null) idx.push(i);
    }
    if (idx.length === 0) return null;

    const prices = idx.flatMap((i) => [series.g[i], series.d[i]]).filter((v): v is number => v != null);
    const coefs = idx.map((i) => series.c[i]).filter((v): v is number => v != null);
    if (prices.length === 0 && coefs.length === 0) return null;

    // 가격축 — 위아래로 조금 띄운다. 딱 맞추면 선이 테두리에 닿는다.
    const pMin = prices.length ? Math.min(...prices) : 0;
    const pMax = prices.length ? Math.max(...prices) : 1;
    const pPad = Math.max(10, (pMax - pMin) * 0.18);
    const p0 = pMin - pPad;
    const p1 = pMax + pPad;

    // 계수축 — 1.000 을 반드시 포함시킨다. 커트라인이 화면 밖이면 점선이 안 보인다.
    const cMin = Math.min(1, ...(coefs.length ? coefs : [1]));
    const cMax = Math.max(1, ...(coefs.length ? coefs : [1]));
    const cPad = Math.max(0.01, (cMax - cMin) * 0.2);
    const c0 = cMin - cPad;
    const c1 = cMax + cPad;

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (k: number) => PAD.left + (idx.length === 1 ? innerW / 2 : (k / (idx.length - 1)) * innerW);
    const yP = (v: number) => PAD.top + innerH - ((v - p0) / (p1 - p0)) * innerH;
    const yC = (v: number) => PAD.top + innerH - ((v - c0) / (c1 - c0)) * innerH;

    /** null 이 섞인 계열을 끊어진 선분들로 만든다. 결측을 직선으로 이으면 거짓말이 된다. */
    function line(values: (number | null)[], y: (v: number) => number): string[] {
      const segs: string[] = [];
      let cur: string[] = [];
      idx.forEach((i, k) => {
        const v = values[i];
        if (v == null) {
          if (cur.length > 1) segs.push(cur.join(" "));
          cur = [];
          return;
        }
        cur.push(`${cur.length ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`);
      });
      if (cur.length > 1) segs.push(cur.join(" "));
      return segs;
    }

    /** 선이 하나뿐인 점은 path 로 안 보인다. 점으로 따로 찍는다. */
    function dots(values: (number | null)[], y: (v: number) => number) {
      const out: Array<{ x: number; y: number }> = [];
      idx.forEach((i, k) => {
        const v = values[i];
        if (v == null) return;
        const prev = k > 0 ? values[idx[k - 1]] : null;
        const next = k < idx.length - 1 ? values[idx[k + 1]] : null;
        if (prev == null && next == null) out.push({ x: x(k), y: y(v) });
      });
      return out;
    }

    // x축 눈금 — 6개 안팎으로 솎는다. 65일치 날짜를 다 쓰면 글자가 겹친다.
    const step = Math.max(1, Math.ceil(idx.length / 6));
    const ticks = idx
      .map((i, k) => ({ k, date: history.dates[i] }))
      .filter(({ k }) => k % step === 0 || k === idx.length - 1);

    const priceTicks = niceTicks(p0, p1, 4);
    const coefTicks = niceTicks(c0, c1, 4);

    const last = idx.at(-1)!;

    return {
      idx, x, yP, yC,
      gasoline: line(series.g, yP), diesel: line(series.d, yP), coef: line(series.c, yC),
      gasolineDots: dots(series.g, yP), dieselDots: dots(series.d, yP), coefDots: dots(series.c, yC),
      ticks, priceTicks, coefTicks,
      cutoffY: c0 <= 1 && 1 <= c1 ? yC(1) : null,
      innerW, innerH,
      from: history.dates[idx[0]], to: history.dates[last],
      latest: { g: series.g[last], d: series.d[last], c: series.c[last] },
    };
  }, [history, series]);

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
            <>
              <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
                aria-label={`${station.name} 휘발유·경유 판매가와 계수 추이`}>
                {/* 가로 눈금선 + 가격축 */}
                {chart.priceTicks.map((v) => (
                  <g key={`p${v}`}>
                    <line className="ch-grid" x1={PAD.left} x2={W - PAD.right}
                      y1={chart.yP(v)} y2={chart.yP(v)} />
                    <text className="ch-axis" x={PAD.left - 8} y={chart.yP(v)}
                      textAnchor="end" dominantBaseline="middle">{Math.round(v).toLocaleString("ko-KR")}</text>
                  </g>
                ))}

                {/* 계수축 */}
                {chart.coefTicks.map((v) => (
                  <text key={`c${v}`} className="ch-axis ch-axis-coef" x={W - PAD.right + 8}
                    y={chart.yC(v)} dominantBaseline="middle">{v.toFixed(3)}</text>
                ))}

                {/* 계수 1.000 = 초록불 커트라인 */}
                {chart.cutoffY != null && (
                  <>
                    <line className="ch-cutoff" x1={PAD.left} x2={W - PAD.right}
                      y1={chart.cutoffY} y2={chart.cutoffY} />
                    <text className="ch-cutoff-label" x={W - PAD.right - 4} y={chart.cutoffY - 5}
                      textAnchor="end">상위권 기준 1.000</text>
                  </>
                )}

                {/* x축 */}
                {chart.ticks.map(({ k, date }) => (
                  <text key={date} className="ch-axis" x={chart.x(k)} y={H - PAD.bottom + 16}
                    textAnchor="middle">{fmtTick(date)}</text>
                ))}

                {chart.gasoline.map((d, i) => (
                  <path key={`g${i}`} d={d} className="ch-line" stroke={COLOR_GASOLINE} />
                ))}
                {chart.diesel.map((d, i) => (
                  <path key={`d${i}`} d={d} className="ch-line" stroke={COLOR_DIESEL} />
                ))}
                {chart.coef.map((d, i) => (
                  <path key={`c${i}`} d={d} className="ch-line ch-line-coef" stroke={COLOR_COEF} />
                ))}

                {chart.gasolineDots.map((p, i) => (
                  <circle key={`gd${i}`} cx={p.x} cy={p.y} r={2.6} fill={COLOR_GASOLINE} />
                ))}
                {chart.dieselDots.map((p, i) => (
                  <circle key={`dd${i}`} cx={p.x} cy={p.y} r={2.6} fill={COLOR_DIESEL} />
                ))}
                {chart.coefDots.map((p, i) => (
                  <circle key={`cd${i}`} cx={p.x} cy={p.y} r={2.6} fill={COLOR_COEF} />
                ))}
              </svg>

              <div className="chart-legend">
                <span><i style={{ background: COLOR_GASOLINE }} />휘발유 {formatPrice(chart.latest.g)}</span>
                <span><i style={{ background: COLOR_DIESEL }} />경유 {formatPrice(chart.latest.d)}</span>
                <span><i style={{ background: COLOR_COEF }} />계수 {chart.latest.c?.toFixed(3) ?? "—"}</span>
                <span className="chart-legend-note">왼쪽 축 원/L · 오른쪽 축 계수</span>
              </div>
            </>
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
    out.push(Math.round(v * 1000) / 1000);
  }
  return out;
}

function fmtDate(d: string): string {
  return `${Number(d.slice(4, 6))}월 ${Number(d.slice(6, 8))}일`;
}

function fmtTick(d: string): string {
  return `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}`;
}
