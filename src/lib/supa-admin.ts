/**
 * 서버측(스크립트) Supabase 접근.
 *
 * 두 경로를 모두 지원한다.
 *   · service_role 키가 있으면 → 테이블을 직접 읽고 쓴다. RLS 를 우회한다.
 *   · anon 키 + 접근코드만 있으면 → 관리 화면과 같은 RPC 로 읽는다. 읽기 전용.
 *
 * 두 갈래를 둔 이유는 검증 때문이다. service_role 키는 GitHub 시크릿에만 두고
 * 로컬에는 내려놓지 않는 게 맞는데, 그러면 손으로 확인할 방법이 없어진다.
 * anon 경로가 있으면 로컬에서 읽기까지는 그대로 확인할 수 있다.
 */

const URL_ = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const CODE = process.env.GS_ACCESS_CODE ?? "kpetro";

export type Mode = "service" | "anon" | "off";

export function mode(): Mode {
  if (!URL_) return "off";
  if (SERVICE) return "service";
  if (ANON) return "anon";
  return "off";
}

export function describeMode(): string {
  switch (mode()) {
    case "service": return "service_role (읽기·쓰기)";
    case "anon": return "anon + 접근코드 (읽기 전용)";
    default: return "미설정";
  }
}

function key(): string {
  return SERVICE || ANON;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: key(),
    Authorization: `Bearer ${key()}`,
    ...extra,
  };
}

async function ensure(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${what} 실패 (HTTP ${res.status}): ${body.slice(0, 300)}`);
}

/** RPC 호출 (anon 경로) */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30_000),
  });
  await ensure(res, `rpc ${fn}`);
  return (await res.json()) as T;
}

/** 테이블 직접 조회 (service_role 경로) */
async function select<T>(table: string, query = "select=*"): Promise<T[]> {
  const res = await fetch(`${URL_}/rest/v1/${table}?${query}`, {
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
  });
  await ensure(res, `select ${table}`);
  return (await res.json()) as T[];
}

let cachedToken: string | null = null;

async function token(): Promise<string> {
  if (cachedToken) return cachedToken;
  const r = await rpc<{ token: string }>("gs_login", { p_code: CODE });
  cachedToken = r.token;
  return cachedToken;
}

// ── 읽기 ────────────────────────────────────────────────────────────

export interface StationRow {
  seq: number;
  name: string;
  address: string;
  sido: string;
  sigungu: string;
  sigungu_detail: string;
  region_key: string;
  station_id: string | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  note: string;
}

export async function fetchStations(): Promise<StationRow[]> {
  if (mode() === "service") return select<StationRow>("gs_station", "select=*&order=seq");
  return rpc<StationRow[]>("gs_stations", { p_token: await token() });
}

export interface ConfigRow {
  rank_green_metro: number;
  rank_green_default: number;
  rank_yellow_factor: number;
}

export async function fetchConfig(): Promise<ConfigRow | null> {
  if (mode() === "service") {
    const rows = await select<ConfigRow>(
      "gs_config", "select=rank_green_metro,rank_green_default,rank_yellow_factor&id=eq.1");
    return rows[0] ?? null;
  }
  // anon 경로는 camelCase 로 온다. 호출부가 한 모양만 보게 여기서 맞춰준다.
  const c = await rpc<{ rankGreenMetro: number; rankGreenDefault: number; rankYellowFactor: number }>(
    "gs_config_get", { p_token: await token() },
  );
  return {
    rank_green_metro: c.rankGreenMetro,
    rank_green_default: c.rankGreenDefault,
    rank_yellow_factor: c.rankYellowFactor,
  };
}

/**
 * 보관된 외부 API 키를 읽는다. service_role 로만 가능하다.
 * anon 경로에서는 값이 내려오지 않도록 설계했으므로 null 을 준다.
 */
export async function fetchSecret(name: string): Promise<string | null> {
  if (mode() !== "service") return null;
  const rows = await select<{ value: string }>(
    "gs_secret", `select=value&name=eq.${encodeURIComponent(name)}`,
  );
  const v = rows[0]?.value?.trim();
  return v ? v : null;
}

// ── 쓰기 ────────────────────────────────────────────────────────────

export interface DailyRow {
  trade_date: string;   // YYYY-MM-DD
  seq: number;
  fuel_type: string;
  price: number | null;
  region_min: number | null;
  region_mean: number | null;
  gap_from_min: number | null;
  signal: string;
  region_rank: number | null;
  region_n: number;
}

/**
 * 일별 판정 결과를 넣는다. 같은 (날짜, 주유소, 유종) 이면 덮어쓴다.
 * 한 번에 다 보내면 요청이 너무 커져 잘라서 보낸다.
 */
export async function upsertDaily(rows: DailyRow[], chunk = 500): Promise<number> {
  if (mode() !== "service") {
    throw new Error("일별 결과 적재는 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  }

  let done = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const res = await fetch(`${URL_}/rest/v1/gs_daily?on_conflict=trade_date,seq,fuel_type`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(part),
      signal: AbortSignal.timeout(60_000),
    });
    await ensure(res, "upsert gs_daily");
    done += part.length;
  }
  return done;
}
