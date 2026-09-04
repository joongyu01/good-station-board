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
  listStations, saveStation, deleteStation,
  getConfig, saveConfig, changeCode,
  listSecrets, saveSecret, deleteSecret,
  supabaseConfig,
  type AdminConfig, type SecretRow, type StationRow,
} from "../lib/supabase.ts";
import { normalizeRegion } from "@shared/lib/region.ts";

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
        <button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ 주유소 추가</button>
      </div>

      {err && <p className="admin-err">{err}</p>}
      {loading && <p className="admin-msg">불러오는 중…</p>}

      {!loading && rows.length === 0 && (
        <div className="admin-msg">
          <p>명단이 비어 있습니다.</p>
          <p className="muted">
            기존 449곳을 옮기려면 <code>npm run supabase:seed</code> 를 실행하세요.
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
      <h3>신호등 임계값</h3>
      <p className="muted">
        바꾼 값은 다음 집계부터 반영됩니다. 이미 만들어진 화면은 그대로 남습니다.
      </p>

      <label>근접(노랑) 상한 — 지역 최저가 + 몇 원까지
        <input type="number" value={c.gapYellow}
          onChange={(e) => setC({ ...c, gapYellow: Number(e.target.value) })} />
      </label>

      <label>표준편차 대체 기준 — 관내 주유소가 몇 곳 미만일 때
        <input type="number" value={c.minSample}
          onChange={(e) => setC({ ...c, minSample: Number(e.target.value) })} />
      </label>

      <label>최저가 판정 최소 주유소 수
        <input type="number" value={c.minCompare}
          onChange={(e) => setC({ ...c, minCompare: Number(e.target.value) })} />
      </label>

      <button className="btn" onClick={async () => {
        try { await saveConfig(token, c); setMsg("저장했습니다."); setErr(null); }
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
