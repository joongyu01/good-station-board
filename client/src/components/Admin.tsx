/**
 * 관리 화면 — `#/admin`
 *
 * 접근코드 하나로만 들어온다. 계정은 없다. 코드가 맞으면 8시간짜리 세션 토큰을
 * 받고, 이후 모든 호출에 그 토큰을 실어 보낸다. 코드 검증도 세션 확인도 전부
 * 서버(SECURITY DEFINER 함수)에서 하므로 브라우저에는 코드가 남지 않는다.
 */
import { useCallback, useEffect, useState } from "react";
import {
  describeError, login, logout, loadToken, ping,
  listStations, saveStation, deleteStation, replaceStations,
  getConfig, saveConfig, changeCode,
  listSecrets, saveSecret, deleteSecret,
  supabaseConfig,
  type AdminConfig, type SecretRow, type StationRow,
} from "../lib/supabase.ts";
import { fetchData, SIGNAL_LABELS } from "../lib/board.ts";
import { normalizeRegion } from "@shared/lib/region.ts";
import { parseStationCsv } from "@shared/lib/station-csv.ts";
import { BRAND_LABELS, type BrandCode } from "@shared/lib/brand.ts";
import type { BoardData, SignalColor } from "@shared/lib/types.ts";

const LOGO = new URL("logo.png", document.baseURI).toString();

type Tab = "stations" | "settings" | "secrets";

export default function Admin({ onExit }: { onExit: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("stations");

  // 저장해둔 토큰이 아직 살아 있으면 바로 들어간다.
  useEffect(() => {
    const t = loadToken();
    if (!t) { setChecking(false); return; }
    ping(t).then((ok) => { if (ok) setToken(t); setChecking(false); });
  }, []);

  if (!supabaseConfig()) {
    return (
      <Shell onExit={onExit}>
        <div className="admin-msg">
          <h2>Supabase 접속 정보가 없습니다</h2>
          <p>
            <code>client/public/config.js</code> 에 Project URL 과 anon public 키를 넣어주세요.
            Supabase 대시보드 → Settings → API 에서 복사할 수 있습니다.
          </p>
        </div>
      </Shell>
    );
  }

  if (checking) return <Shell onExit={onExit}><div className="admin-msg"><p>확인 중…</p></div></Shell>;
  if (!token) return <Shell onExit={onExit}><Gate onIn={setToken} /></Shell>;

  return (
    <Shell
      onExit={onExit}
      right={
        <button className="btn-ghost" onClick={() => { logout(token); setToken(null); }}>
          로그아웃
        </button>
      }
    >
      <nav className="admin-tabs" role="tablist">
        {([["stations", "착한주유소 명단"], ["settings", "판정 설정"], ["secrets", "API 키"]] as const)
          .map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k}
              className={tab === k ? "is-active" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
      </nav>

      {tab === "stations" && <Stations token={token} onExpire={() => setToken(null)} />}
      {tab === "settings" && <Settings token={token} onExpire={() => setToken(null)} />}
      {tab === "secrets" && <Secrets token={token} onExpire={() => setToken(null)} />}
    </Shell>
  );
}

function Shell({ children, onExit, right }: {
  children: React.ReactNode; onExit: () => void; right?: React.ReactNode;
}) {
  return (
    <>
      <header className="topbar">
        <span className="topbar-logo">
          <img src={LOGO} alt="한국석유관리원" />
        </span>
        <div className="brand">
          <h1>착한주유소 관리</h1>
        </div>
        <div className="admin-actions">
          {right}
          <button className="btn-ghost" onClick={onExit}>현황판으로</button>
        </div>
      </header>
      <div className="page">
        {children}
        <div className="copyright">
          © 2026 Korea Petroleum Quality &amp; Distribution Authority.
          <div className="cr-sub">Developed by Joongyu Shin.</div>
        </div>
      </div>
    </>
  );
}

// ── 접근코드 ─────────────────────────────────────────────────────────
function Gate({ onIn }: { onIn: (t: string) => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onIn(await login(code));
    } catch (e2) {
      setErr(describeError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="gate" onSubmit={submit}>
      <img className="gate-logo" src={LOGO} alt="한국석유관리원" />
      <h2>접근코드</h2>
      <p className="gate-sub">명단을 수정하려면 접근코드가 필요합니다.</p>
      <input
        type="password" value={code} autoFocus
        onChange={(e) => setCode(e.target.value)}
        placeholder="접근코드" aria-label="접근코드"
      />
      <button type="submit" disabled={busy || !code}>{busy ? "확인 중…" : "들어가기"}</button>
      {err && <p className="gate-err">{err}</p>}
    </form>
  );
}

// ── 명단 ─────────────────────────────────────────────────────────────
const EMPTY: Partial<StationRow> = { name: "", address: "", station_id: "", note: "", active: true };

function Stations({ token, onExpire }: { token: string; onExpire: () => void }) {
  const [rows, setRows] = useState<StationRow[]>([]);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<StationRow> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listStations(token));
      setErr(null);
    } catch (e) {
      setErr(describeError(e));
      if (String(e).includes("NO_SESSION")) onExpire();
    } finally {
      setLoading(false);
    }
  }, [token, onExpire]);

  useEffect(() => { reload(); }, [reload]);

  async function save(s: Partial<StationRow>) {
    // 지역 필드는 주소에서 파생한다. 파이프라인과 같은 규칙(src/lib/region.ts)을
    // 그대로 써야 집계 키가 어긋나지 않는다.
    const region = normalizeRegion(s.address ?? "");
    try {
      await saveStation(token, {
        ...s,
        sido: region?.sido ?? "",
        sigungu: region?.sigungu ?? "",
        sigungu_detail: region?.sigunguDetail ?? "",
        region_key: region?.key ?? "",
      });
      setEdit(null);
      await reload();
    } catch (e) {
      setErr(describeError(e));
    }
  }

  async function remove(seq: number, name: string) {
    if (!confirm(`${name} 을(를) 명단에서 지울까요?`)) return;
    try {
      await deleteStation(token, seq);
      await reload();
    } catch (e) {
      setErr(describeError(e));
    }
  }

  const filtered = q.trim()
    ? rows.filter((r) => (r.name + r.address + r.sigungu).includes(q.trim()))
    : rows;

  return (
    <section className="admin-body">
      <div className="admin-bar">
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="상호·주소·지역 검색" aria-label="검색" />
        <span className="admin-count">{filtered.length} / {rows.length}곳</span>
        <CsvUpload token={token} onDone={reload} onError={setErr} />
        <button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ 주유소 추가</button>
      </div>

      {err && <p className="admin-err">{err}</p>}
      {loading && <p className="admin-msg">불러오는 중…</p>}

      {!loading && rows.length === 0 && (
        <div className="admin-msg">
          <p>명단이 비어 있습니다.</p>
          <p className="muted">
            위의 <strong>CSV 올리기</strong> 로 명단 파일을 넣거나,
            저장소에서 <code>npm run supabase:seed</code> 를 실행하세요.
          </p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>상호</th>
              <th>주소</th>
              <th>지역</th>
              <th>주유소코드</th>
              <th>폴</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.seq} className={r.active ? "" : "is-off"}>
                <td className="num muted">{r.seq}</td>
                <td>{r.name}</td>
                <td className="addr">{r.address}</td>
                <td className="muted">{r.sido} {r.sigungu}</td>
                <td className="mono">{r.station_id ?? <span className="muted">—</span>}</td>
                <td className="muted" title={r.brand ? BRAND_LABELS[r.brand as BrandCode] ?? "" : ""}>
                  {r.brand ?? "—"}{r.is_self ? " · 셀프" : ""}
                </td>
                <td>{r.active ? "운영" : <span className="muted">제외</span>}</td>
                <td className="row-actions">
                  <button className="btn-ghost" onClick={() => setEdit(r)}>수정</button>
                  <button className="btn-ghost danger" onClick={() => remove(r.seq, r.name)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {edit && <StationForm value={edit} onCancel={() => setEdit(null)} onSave={save} />}
    </section>
  );
}

function StationForm({ value, onSave, onCancel }: {
  value: Partial<StationRow>;
  onSave: (s: Partial<StationRow>) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<Partial<StationRow>>(value);
  const region = normalizeRegion(s.address ?? "");

  return (
    <div className="modal-back" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSave(s); }}>
        <h3>{s.seq == null ? "주유소 추가" : `#${s.seq} 수정`}</h3>

        <label>상호
          <input value={s.name ?? ""} autoFocus
            onChange={(e) => setS({ ...s, name: e.target.value })} />
        </label>

        <label>주소 (도로명)
          <input value={s.address ?? ""}
            onChange={(e) => setS({ ...s, address: e.target.value })}
            placeholder="예: 강원 철원군 서면 와수1로 40" />
        </label>

        <p className={`form-hint ${region ? "ok" : "warn"}`}>
          {region
            ? `지역 인식: ${region.sido} ${region.sigunguDetail}`
            : "주소에서 시·도와 시·군·구를 읽지 못했습니다. 저장은 되지만 집계에서 빠집니다."}
        </p>

        <label>오피넷 주유소코드 <span className="muted">(비우면 자동 매칭)</span>
          <input value={s.station_id ?? ""} className="mono"
            onChange={(e) => setS({ ...s, station_id: e.target.value })}
            placeholder="예: A0033752" />
        </label>

        <div className="form-row">
          <label>위도 <span className="muted">(선택)</span>
            <input type="number" step="0.000001" value={s.lat ?? ""}
              onChange={(e) => setS({ ...s, lat: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          <label>경도 <span className="muted">(선택)</span>
            <input type="number" step="0.000001" value={s.lng ?? ""}
              onChange={(e) => setS({ ...s, lng: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
        </div>

        <label>메모
          <input value={s.note ?? ""} onChange={(e) => setS({ ...s, note: e.target.value })} />
        </label>

        <label className="check">
          <input type="checkbox" checked={s.active ?? true}
            onChange={(e) => setS({ ...s, active: e.target.checked })} />
          현황판에 표시 (해제하면 집계에서 제외)
        </label>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>취소</button>
          <button type="submit" className="btn">저장</button>
        </div>
      </form>
    </div>
  );
}

// ── 판정 설정 ────────────────────────────────────────────────────────
/**
 * 두 방식이 실제로 몇 곳을 어떻게 가르는지 나란히 보여준다.
 *
 * 설정만 바꿔 놓고 저장하면 다음 집계까지 결과를 볼 수 없다. 집계가 두 방식을
 * 모두 계산해 `latest.json` 에 함께 실어 두므로, 지금 커밋된 자료로 견줄 수는
 * 있다. 여기서 보이는 개수는 **저장된 설정으로 집계된 값**이라, 위 라디오를
 * 방금 바꾼 것은 아직 반영되지 않는다.
 */
function JudgeCompare() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchData("latest.json")
      .then((r) => r.json())
      .then(setBoard)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="admin-err">현황 자료를 못 읽었습니다. ({err})</p>;
  if (!board) return <p className="admin-msg">현황 자료를 불러오는 중…</p>;
  if (!board.summary.adjustedCounts) {
    return <p className="muted">아직 보정 값이 실리지 않은 자료입니다. 집계를 한 번 돌리면 나옵니다.</p>;
  }

  const rows: [SignalColor, string][] = [
    ["green", SIGNAL_LABELS.green], ["yellow", SIGNAL_LABELS.yellow], ["red", SIGNAL_LABELS.red],
    ["stale", SIGNAL_LABELS.stale], ["unknown", SIGNAL_LABELS.unknown],
  ];
  const cur = board.summary.counts;
  const adj = board.summary.adjustedCounts;
  const unconfirmed = board.baseline
    ? Object.keys(board.baseline.windows).filter((r) => !board.baseline!.confirmedRounds.includes(r))
    : [];

  return (
    <div className="judge-compare">
      <h4>{board.date.slice(4, 6)}월 {board.date.slice(6, 8)}일 자료로 견준 결과</h4>
      <table className="admin-table">
        <thead><tr><th>판정</th><th>현재</th><th>보정</th><th>차이</th></tr></thead>
        <tbody>
          {rows.map(([k, label]) => {
            const d = adj[k] - cur[k];
            return (
              <tr key={k}>
                <td>{label}</td>
                <td>{cur[k]}</td>
                <td>{adj[k]}</td>
                <td className={d > 0 ? "up" : d < 0 ? "down" : ""}>{d > 0 ? `+${d}` : d || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {board.baseline && (
        <p className="muted" style={{ fontSize: "12px" }}>
          선정 때 후보에서 빠졌던 것으로 보이는 주유소 {board.baseline.excludedCount}곳을 모집단에서 뺐습니다.
          {unconfirmed.length > 0 && (
            <>
              {" "}<b>{unconfirmed.join("·")}</b> 는 선정 기준기간을 확인하지 못해{" "}
              {board.baseline.windows[unconfirmed[0]]?.slice(0, 4)}년{" "}
              {board.baseline.windows[unconfirmed[0]]?.slice(4, 6)}월로 두었습니다 —
              그 이전에 올린 몫은 잡히지 않아 실제보다 후하게 나옵니다.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Settings({ token, onExpire }: { token: string; onExpire: () => void }) {
  const [c, setC] = useState<AdminConfig | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");

  useEffect(() => {
    getConfig(token).then(setC).catch((e) => {
      setErr(describeError(e));
      if (String(e).includes("NO_SESSION")) onExpire();
    });
  }, [token, onExpire]);

  if (err && !c) return <p className="admin-err">{err}</p>;
  if (!c) return <p className="admin-msg">불러오는 중…</p>;

  return (
    <section className="admin-body narrow">
      <h3>신호등 기준 순위</h3>
      <p className="muted">
        비교 모집단은 <b>시·도</b>입니다. 그 시·도에서 몇 위 안에 들면 초록으로 볼지 정합니다.
        바꾼 값은 다음 집계부터 반영됩니다.
      </p>

      <label>서울·경기 — 몇 위 이내를 초록으로
        <input type="number" value={c.rankGreenMetro}
          onChange={(e) => setC({ ...c, rankGreenMetro: Number(e.target.value) })} />
      </label>

      <label>그 밖의 시·도 — 몇 위 이내를 초록으로
        <input type="number" value={c.rankGreenDefault}
          onChange={(e) => setC({ ...c, rankGreenDefault: Number(e.target.value) })} />
      </label>

      <label>노랑 구간 배수 <span className="muted">(초록 기준의 몇 배 순위까지)</span>
        <input type="number" value={c.rankYellowFactor}
          onChange={(e) => setC({ ...c, rankYellowFactor: Number(e.target.value) })} />
      </label>
      <p className="muted" style={{ fontSize: "12px", marginTop: "6px" }}>
        현재 설정: 서울·경기 {c.rankGreenMetro}위 이내 초록 · {c.rankGreenMetro * c.rankYellowFactor}위까지 노랑 /
        그 외 {c.rankGreenDefault}위 이내 초록 · {c.rankGreenDefault * c.rankYellowFactor}위까지 노랑
      </p>

      <hr />

      <h3>판정 방식</h3>
      <p className="muted">
        명단 472곳은 <b>아홉 차수</b>에 걸쳐 뽑혔고 차수마다 선정 기준기간이 다릅니다.
        그런데 지금 판정은 1차부터 9차까지 전부 <b>오늘의 상위 N위</b> 라는 한 잣대로 잽니다.
        선정된 지 오래된 차수가 뒤로 밀리는 것은 그 주유소 사정이 아니라 잣대가 묻는 질문이
        달라서입니다.
      </p>
      <p className="muted">
        <b>보정</b> 은 대신 이렇게 묻습니다 — 선정 시점에 견줘, 그 지역 시장이 오른 만큼을
        빼고도 더 올렸는가. 기준가에 시장 변동률을 곱한 값을 기대가로 두고 실제가와 견줍니다.
        시장 기준은 시·도 <b>중앙값</b> 이라 몇 곳이 빠지고 드는 것에 흔들리지 않습니다.
      </p>

      <label className="admin-radio">
        <input type="radio" name="judge" checked={c.judgeMode === "rank"}
          onChange={() => setC({ ...c, judgeMode: "rank" })} />
        <span>현재 — 오늘 그 시·도에서 몇 위냐</span>
      </label>
      <label className="admin-radio">
        <input type="radio" name="judge" checked={c.judgeMode === "adjusted"}
          onChange={() => setC({ ...c, judgeMode: "adjusted" })} />
        <span>보정 — 선정 시점 대비 시장연동 이탈까지 본다</span>
      </label>

      <h4>보정을 무엇으로 판정할지</h4>
      <label className="admin-radio">
        <input type="radio" name="combine" checked={c.adjustedCombine === "both"}
          onChange={() => setC({ ...c, adjustedCombine: "both" })} />
        <span>순위와 이탈률을 <b>둘 다</b> 통과해야 적합 <span className="muted">— 가장 엄격</span></span>
      </label>
      <label className="admin-radio">
        <input type="radio" name="combine" checked={c.adjustedCombine === "drift"}
          onChange={() => setC({ ...c, adjustedCombine: "drift" })} />
        <span><b>이탈률만</b> <span className="muted">— '선정 뒤에 더 올렸나' 하나만 묻는다</span></span>
      </label>
      <label className="admin-radio">
        <input type="radio" name="combine" checked={c.adjustedCombine === "rank"}
          onChange={() => setC({ ...c, adjustedCombine: "rank" })} />
        <span><b>보정 모집단 순위만</b> <span className="muted">— 선정 때 빠졌던 곳을 뺀 분포에서 순위</span></span>
      </label>

      <label>이탈률 — 이 값(%) 이하면 적합
        <input type="number" step="0.1" value={c.driftGreen * 100}
          onChange={(e) => setC({ ...c, driftGreen: Number(e.target.value) / 100 })} />
      </label>
      <label>이탈률 — 이 값(%) 이하면 근접, 넘으면 초과
        <input type="number" step="0.1" value={c.driftYellow * 100}
          onChange={(e) => setC({ ...c, driftYellow: Number(e.target.value) / 100 })} />
      </label>

      <JudgeCompare />

      <button className="btn" onClick={async () => {
        try { await saveConfig(token, c); setMsg("저장했습니다. 다음 집계부터 현황판에 반영됩니다."); setErr(null); }
        catch (e) { setErr(describeError(e)); }
      }}>설정 저장</button>

      <hr />

      <h3>접근코드 변경</h3>
      <p className="muted">바꾸면 지금 열려 있는 모든 세션이 끊깁니다.</p>
      <label>새 접근코드
        <input type="password" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
      </label>
      <button className="btn danger" disabled={newCode.length < 4} onClick={async () => {
        if (!confirm("접근코드를 바꾸면 모든 세션이 끊깁니다. 계속할까요?")) return;
        try { await changeCode(token, newCode); onExpire(); }
        catch (e) { setErr(describeError(e)); }
      }}>접근코드 변경</button>

      {msg && <p className="admin-ok">{msg}</p>}
      {err && <p className="admin-err">{err}</p>}
    </section>
  );
}

// ── API 키 ───────────────────────────────────────────────────────────
function Secrets({ token, onExpire }: { token: string; onExpire: () => void }) {
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [name, setName] = useState("OPINET_API_KEY");
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(() => {
    listSecrets(token).then(setRows).catch((e) => {
      setErr(describeError(e));
      if (String(e).includes("NO_SESSION")) onExpire();
    });
  }, [token, onExpire]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <section className="admin-body narrow">
      <h3>외부 API 키</h3>
      <p className="muted">
        저장한 값은 <b>화면으로 다시 내려오지 않습니다.</b> 설정 여부와 앞뒤 몇 자만 보입니다.
        실제 값은 수집 작업(GitHub Actions)이 service_role 키로 직접 읽어갑니다.
      </p>

      {rows.length > 0 && (
        <table className="admin-table">
          <thead><tr><th>이름</th><th>값</th><th>수정</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="mono">{r.name}</td>
                <td className="mono muted">{r.isSet ? r.hint : "미설정"}</td>
                <td className="muted">{new Date(r.updatedAt).toLocaleDateString("ko-KR")}</td>
                <td className="row-actions">
                  <button className="btn-ghost danger" onClick={async () => {
                    if (!confirm(`${r.name} 을(를) 지울까요?`)) return;
                    try { await deleteSecret(token, r.name); reload(); }
                    catch (e) { setErr(describeError(e)); }
                  }}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr />
      <label>키 이름
        <input className="mono" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>값
        <input type="password" className="mono" value={value}
          onChange={(e) => setValue(e.target.value)} placeholder="발급받은 키를 붙여넣기" />
      </label>
      <button className="btn" disabled={!name || !value} onClick={async () => {
        try {
          await saveSecret(token, name, value);
          setValue("");
          setErr(null);
          reload();
        } catch (e) { setErr(describeError(e)); }
      }}>키 저장</button>

      {err && <p className="admin-err">{err}</p>}
    </section>
  );
}

// ── CSV 업로드 ───────────────────────────────────────────────────────
//
// 파싱은 브라우저에서 한다. 빌드 스크립트(`npm run normalize`)와 같은
// src/lib/station-csv.ts 를 쓰기 때문에 화면에서 올린 명단과 저장소에서 만든
// 명단이 항상 같은 규칙으로 정규화된다.
//
// 올리기 전에 무엇이 바뀌는지 먼저 보여준다. 명단을 통째로 갈아끼우는
// 동작이라 되돌리기가 어렵다.
interface Preview {
  fileName: string;
  rows: Array<Record<string, unknown>>;
  total: number;
  withId: number;
  brands: Array<[string, number]>;
  failures: Array<{ line: number; name: string; reason: string }>;
  unknownBrands: Array<[string, number]>;
}

function CsvUpload({ token, onDone, onError }: {
  token: string;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 두 번 고를 수 있어야 한다. 값을 비우지 않으면 change 가 안 뜬다.
    e.target.value = "";
    if (!file) return;

    onError(null);
    setDone(null);

    // 엑셀에서 저장한 CSV 는 BOM 이 붙은 UTF-8 이거나 EUC-KR 이다. 먼저 UTF-8 로
    // 읽어 보고 대체문자(U+FFFD)가 섞이면 EUC-KR 로 다시 읽는다.
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("\uFFFD")) {
      try { text = new TextDecoder("euc-kr").decode(buf); } catch { /* 그대로 간다 */ }
    }

    const parsed = parseStationCsv(text);
    if (parsed.stations.length === 0) {
      onError(
        parsed.failures[0]?.reason
          ?? "CSV 에서 주유소를 하나도 읽지 못했습니다. 헤더에 `상호`·`주소` 열이 있는지 확인해 주세요.",
      );
      return;
    }

    const brands = new Map<string, number>();
    for (const s of parsed.stations) {
      const b = s.brand ?? "미상";
      brands.set(b, (brands.get(b) ?? 0) + 1);
    }

    setPreview({
      fileName: file.name,
      rows: parsed.stations.map((s) => ({
        seq: s.seq,
        name: s.name,
        address: s.address,
        sido: s.sido,
        sigungu: s.sigungu,
        sigungu_detail: s.sigunguDetail,
        region_key: s.regionKey,
        station_id: s.stationId ?? "",
        brand: s.brand ?? "",
        is_self: s.isSelf,
        round: s.round ?? "",
      })),
      total: parsed.stations.length,
      withId: parsed.stations.filter((s) => s.stationId).length,
      brands: [...brands.entries()].sort((a, b) => b[1] - a[1]),
      failures: parsed.failures.slice(0, 20),
      unknownBrands: [...parsed.unknownBrands.entries()],
    });
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    onError(null);
    try {
      const r = await replaceStations(token, preview.rows);
      setDone(`${r.count}곳으로 교체했습니다. 기존 좌표 ${r.coords_kept}곳을 이어받았습니다.`);
      setPreview(null);
      onDone();
    } catch (e) {
      onError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="btn btn-file">
        CSV 올리기
        <input type="file" accept=".csv,text/csv" onChange={pick} hidden />
      </label>

      {done && <span className="admin-ok">{done}</span>}

      {preview && (
        <div className="modal-back" onClick={() => setPreview(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>명단 교체 확인</h3>
            <p className="csv-file">
              <code>{preview.fileName}</code>
            </p>

            <dl className="csv-stat">
              <div><dt>읽어낸 주유소</dt><dd><strong>{preview.total}</strong>곳</dd></div>
              <div><dt>오피넷 주유소코드</dt><dd>{preview.withId}곳</dd></div>
              <div><dt>건너뛴 행</dt><dd>{preview.failures.length ? `${preview.failures.length}건` : "없음"}</dd></div>
            </dl>

            <p className="csv-brands">
              {preview.brands.map(([b, n]) => (
                <span key={b} title={BRAND_LABELS[b as BrandCode] ?? b}>
                  {b} <strong>{n}</strong>
                </span>
              ))}
            </p>

            {preview.unknownBrands.length > 0 && (
              <p className="csv-warn">
                해석하지 못한 상표 표기: {preview.unknownBrands.map(([b, n]) => `${b}(${n})`).join(", ")}
                <br />폴 코드 없이 등록됩니다.
              </p>
            )}

            {preview.failures.length > 0 && (
              <div className="csv-fails">
                <strong>건너뛴 행</strong>
                <ul>
                  {preview.failures.map((f) => (
                    <li key={f.line}>{f.line}행 {f.name} — {f.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="csv-warn">
              기존 명단을 <strong>전부 지우고</strong> 이 파일로 바꿉니다.
              주유소코드가 같은 곳은 좌표를 이어받습니다.
            </p>

            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>취소</button>
              <button type="button" className="btn" onClick={commit} disabled={busy}>
                {busy ? "교체 중…" : `${preview.total}곳으로 교체`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
