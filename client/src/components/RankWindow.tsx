/**
 * 계수 검증용 순위표 창.
 *
 * 계수는 `그 주유소 값 ÷ 그 시·도의 상위권 커트라인` 이다. 화면에는 계수만
 * 나오니 그 값이 맞는지 확인할 길이 없었다. 여기서 그날 그 시·도의 줄 세운
 * 결과를 그대로 펼쳐 커트라인이 어디서 잘렸는지 보여준다.
 *
 * 전국 원본은 무거워 시·도별 상위 K건만 싣는다(scripts/build-ranks.ts).
 * 커트라인은 N위·2N위라 K=30 안에 반드시 들어온다.
 */
import { useEffect, useMemo, useState } from "react";
import { dataUrl, formatPrice, sidoLabel } from "../lib/board.ts";
import { VIEW_MODES, VIEW_MODE_LABELS, type ViewMode } from "@shared/lib/types.ts";
import type { RankFile } from "@shared/lib/rank.ts";

interface Props {
  /** 열릴 때 고를 날짜 — 현황판이 보고 있는 기준일 */
  date: string;
  /** 처음 보여줄 시·도. 드릴다운 중이면 그 지역 */
  sido: string | null;
  mode: ViewMode;
  onClose: () => void;
}

const cache = new Map<string, Promise<RankFile>>();
function loadRank(date: string): Promise<RankFile> {
  let p = cache.get(date);
  if (!p) {
    p = fetch(dataUrl(`rank-${date}.json`)).then((r) => {
      if (!r.ok) throw new Error(`rank-${date}.json ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(date));
    cache.set(date, p);
  }
  return p;
}

export default function RankWindow({ date, sido, mode, onClose }: Props) {
  const [dates, setDates] = useState<string[]>([date]);
  const [day, setDay] = useState(date);
  const [region, setRegion] = useState<string | null>(sido);
  const [view, setView] = useState<ViewMode>(mode);
  const [file, setFile] = useState<RankFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // 고를 수 있는 날짜 — 순위표가 실제로 있는 날만.
  useEffect(() => {
    let alive = true;
    fetch(dataUrl("index.json"))
      .then((r) => r.json())
      .then((j: { ranks?: string[] }) => {
        if (!alive || !j.ranks?.length) return;
        setDates(j.ranks);
        // 기본값은 현황판이 보는 기준일. 그 날짜가 없으면 가장 최근 것.
        if (!j.ranks.includes(date)) setDay(j.ranks[0]);
      })
      .catch(() => { /* 목록을 못 받아도 오늘 날짜 하나로는 동작한다 */ });
    return () => { alive = false; };
  }, [date]);

  useEffect(() => {
    let alive = true;
    setFile(null);
    setError(null);
    loadRank(day)
      .then((f) => { if (alive) setFile(f); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [day]);

  const sidos = useMemo(() => (file ? Object.keys(file.regions).sort() : []), [file]);

  // 고른 시·도가 그날 자료에 없으면 첫 번째로 물러선다.
  const active = region && file?.regions[region] ? region : sidos[0] ?? null;
  const table = active ? file?.regions[active]?.[view] ?? null : null;

  return (
    <>
      <div className="rank-back" onClick={onClose} role="presentation" />
      <div className="sheet rank-win" role="dialog" aria-modal="true" aria-label="계수 검증 순위표">
      <header className="sheet-head">
        <div className="sheet-head-main">
          <h2 className="sheet-title">계수 검증 — 시·도 순위표</h2>
          <p className="panel-sub">
            그날 그 시·도를 값 오름차순으로 줄 세운 결과입니다. 계수 1.000 이 되는
            커트라인이 어디서 잘렸는지 확인할 수 있습니다.
          </p>
        </div>
        <button type="button" className="sheet-close" onClick={onClose} aria-label="닫기">✕</button>
      </header>

      <div className="rank-bar">
        <label>
          날짜
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
          </select>
        </label>

        <label>
          시·도
          <select value={active ?? ""} onChange={(e) => setRegion(e.target.value)}>
            {sidos.map((s) => <option key={s} value={s}>{sidoLabel(s)}</option>)}
          </select>
        </label>

        <div className="rank-modes" role="group" aria-label="기준">
          {VIEW_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={view === m ? "is-active" : ""}
              onClick={() => setView(m)}
            >
              {VIEW_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-body is-scroll">
        {error && (
          <p className="chart-msg">
            {fmtDate(day)} 순위표가 없습니다.<br />
            <code>npm run ranks {day}</code> 로 만들 수 있습니다.
          </p>
        )}
        {!error && !file && <p className="chart-msg">불러오는 중…</p>}

        {table && (
          <>
            <dl className="rank-facts">
              <div>
                <dt>모집단</dt>
                <dd>{table.n.toLocaleString("ko-KR")}곳</dd>
              </div>
              <div>
                <dt>적합 커트라인 ({table.greenRank}위)</dt>
                <dd className="d-g">{formatPrice(table.greenBase)}</dd>
              </div>
              <div>
                <dt>근접 커트라인 ({table.yellowRank}위)</dt>
                <dd className="d-y">{formatPrice(table.yellowBase)}</dd>
              </div>
              <div>
                <dt>보여주는 범위</dt>
                <dd>상위 {Math.min(file!.topK, table.n)}위</dd>
              </div>
            </dl>

            <table className="rank-table">
              <thead>
                <tr>
                  <th className="num">순위</th>
                  <th>주유소</th>
                  <th>시·군·구</th>
                  <th className="num">휘발유</th>
                  <th className="num">경유</th>
                  <th className="num">{view === "sum" ? "합계" : VIEW_MODE_LABELS[view]}</th>
                  <th className="num">계수</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => {
                  // 커트라인 바로 아래 줄에 선을 그어 경계를 눈에 보이게 한다.
                  const cls = [
                    r.good ? "is-good" : "",
                    r.r === table.greenRank ? "is-cut-g" : "",
                    r.r === table.yellowRank ? "is-cut-y" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <tr key={`${r.stationId}-${i}`} className={cls}>
                      <td className="num">{r.r}</td>
                      <td className="col-name">
                        {r.name}
                        {r.good && <span className="badge badge-low">착한주유소</span>}
                      </td>
                      <td className="muted">{r.sigungu}</td>
                      <td className="num">{formatPrice(r.gasoline)}</td>
                      <td className="num">{formatPrice(r.diesel)}</td>
                      <td className="num"><b>{r.v.toLocaleString("ko-KR")}</b></td>
                      <td className="num idx">
                        {table.greenBase ? (r.v / table.greenBase).toFixed(3) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
      </div>
    </>
  );
}

function fmtDate(d: string): string {
  if (!/^\d{8}$/.test(d)) return d;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}
