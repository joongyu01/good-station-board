/**
 * 계수 검증용 순위표 창.
 *
 * 계수는 `그 주유소 값 ÷ 그 시·도의 상위권 커트라인` 이다. 화면에는 계수만
 * 나오니 그 값이 맞는지 확인할 길이 없었다. 여기서 그날 그 시·도의 줄 세운
 * 결과를 그대로 펼쳐 커트라인이 어디서 잘렸는지 보여준다.
 *
 * 전국 원본은 무거워 시·도별 상위 몇 줄만 싣는다(scripts/build-ranks.ts).
 * 자를 때 행 수가 아니라 **조밀 순위**로 세므로 동점이 몰려도 커트라인까지 닿는다.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchData, formatPrice, sidoLabel } from "../lib/board.ts";
import { VIEW_MODES, VIEW_MODE_LABELS, type ViewMode } from "@shared/lib/types.ts";
import type { RankFile } from "@shared/lib/rank.ts";
import { COEF_DIGITS, greenRankWith } from "@shared/lib/signal.ts";
import { baseAt, type Judging } from "@shared/lib/judge.ts";

interface Props {
  /** 열릴 때 고를 날짜 — 현황판이 보고 있는 기준일 */
  date: string;
  /** 처음 보여줄 시·도. 드릴다운 중이면 그 지역 */
  sido: string | null;
  mode: ViewMode;
  /** 지금 적용 중인 판정 설정. 커트라인을 이 값으로 다시 잡는다. */
  judging: Judging | null;
  onClose: () => void;
}

const cache = new Map<string, Promise<RankFile>>();
function loadRank(date: string): Promise<RankFile> {
  let p = cache.get(date);
  if (!p) {
    p = fetchData(`rank-${date}.json`).then((r) => {
      if (!r.ok) throw new Error(`rank-${date}.json ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(date));
    cache.set(date, p);
  }
  return p;
}

export default function RankWindow({ date, sido, mode, judging, onClose }: Props) {
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
    fetchData("index.json")
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
  const stored = active ? file?.regions[active]?.[view] ?? null : null;

  /**
   * 커트라인을 지금 설정으로 다시 잡는다.
   *
   * 순위표 파일은 집계가 만들 때의 기준 순위로 커트라인을 박아 둔다. 그런데
   * 관리 화면에서 기준 순위를 바꾸면 현황판의 계수는 바로 따라 움직이므로,
   * 여기를 그대로 두면 **검증하러 연 창이 화면과 어긋난다.**
   *
   * 파일에 실린 커트라인 목록에서 찾는다. 보이는 줄에서 세면 안 된다 — 동점이
   * 많으면 30줄이 조밀 순위 열몇 위까지밖에 못 가 2N위가 목록 밖으로 나간다.
   */
  const table = useMemo(() => {
    if (!stored || !active || !judging) return stored;
    const greenRank = greenRankWith(active, judging);
    const yellowRank = greenRank * judging.rankYellowFactor;
    if (greenRank === stored.greenRank && yellowRank === stored.yellowRank) return stored;
    return {
      ...stored,
      greenRank,
      yellowRank,
      greenBase: baseAt(stored.cutoffs, greenRank),
      yellowBase: baseAt(stored.cutoffs, yellowRank),
    };
  }, [stored, active, judging]);

  /**
   * 커트라인이 놓이는 줄.
   *
   * 그 순위와 **값이 같은 마지막 줄**이다. 동점이 열 줄이면 열 줄 모두가 그
   * 순위라, 각 줄에 선을 그으면 경계가 아니라 줄무늬가 된다. 그 순위가 아예
   * 없으면(값이 건너뛴 경우) 그보다 앞선 마지막 줄에 긋는다.
   */
  const cutAt = (rank: number): number => {
    if (!table) return -1;
    let at = -1;
    for (let i = 0; i < table.rows.length; i++) if (table.rows[i].r <= rank) at = i;
    return at;
  };
  const greenCutAt = table ? cutAt(table.greenRank) : -1;
  const yellowCutAt = table ? cutAt(table.yellowRank) : -1;
  /** 줄 수 상한에 걸려 실으려던 순위까지 못 간 경우. */
  const cutShort = !!table && !!file && (table.shownRank ?? 0) > 0 && table.shownRank < file.topRank;

  return (
    <>
      <div className="rank-back" onClick={onClose} role="presentation" />
      <div className="sheet rank-win" role="dialog" aria-modal="true" aria-label="계수 검증 순위표">
      <header className="sheet-head">
        <div className="sheet-head-main">
          <h2 className="sheet-title">계수 검증 — 시·도 순위표</h2>
          <p className="panel-sub">
            그날 그 시·도를 값 오름차순으로 줄 세운 결과입니다. 계수 1 이 되는
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
                <dd>
                  상위 {table.shownRank ?? file!.topRank}위 · {table.rows.length.toLocaleString("ko-KR")}줄
                  {cutShort && <span className="muted"> (줄 수 상한)</span>}
                </dd>
              </div>
            </dl>

            <table className="rank-table">
              <thead>
                <tr>
                  <th className="num" title="위에서부터 센 줄 번호. 동점이 있으면 순위와 어긋난다">순번</th>
                  <th className="num" title="같은 값이면 같은 순위(조밀 순위). 계수와 커트라인은 이 순위로 센다">순위</th>
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
                  // 커트라인 **마지막 줄**에만 선을 긋는다. 동점이 열 줄이면
                  // 열 줄 모두에 그어져 표 전체가 줄무늬가 됐다.
                  const cls = [
                    r.good ? "is-good" : "",
                    i === greenCutAt ? "is-cut-g" : "",
                    i === yellowCutAt ? "is-cut-y" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <tr key={`${r.stationId}-${i}`} className={cls}>
                      <td className="num muted">{i + 1}</td>
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
                        {table.greenBase ? (r.v / table.greenBase).toFixed(COEF_DIGITS) : "—"}
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
