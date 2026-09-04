/**
 * Supabase RPC 호출.
 *
 * SDK를 쓰지 않는다. 이 프로젝트는 테이블을 직접 건드리지 않고 SECURITY DEFINER
 * 함수만 부르기 때문에 `fetch` 한 줄이면 충분하고, 번들도 그만큼 가벼워진다.
 *
 * 접속 정보는 번들이 아니라 `public/config.js` 에서 읽는다. 빌드를 다시 하지 않고도
 * 프로젝트를 바꿀 수 있어야 하기 때문이다.
 */

declare global {
  interface Window {
    GS_CONFIG?: { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string };
  }
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function supabaseConfig(): SupabaseConfig | null {
  const c = window.GS_CONFIG;
  const url = (c?.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const anonKey = (c?.SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** 서버가 raise exception 으로 던진 코드. 화면에서 문구로 바꿔 쓴다. */
export class RpcError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = "RpcError";
  }
}

const MESSAGES: Record<string, string> = {
  INVALID_CODE: "접근코드가 맞지 않습니다.",
  NO_SESSION: "로그인이 만료되었습니다. 다시 입력해 주세요.",
  NAME_REQUIRED: "주유소 상호를 입력해 주세요.",
  ADDRESS_REQUIRED: "주소를 입력해 주세요.",
  CODE_TOO_SHORT: "접근코드는 4자 이상이어야 합니다.",
  RANK_RANGE: "기준 순위는 1~500 사이여야 합니다.",
  FACTOR_RANGE: "노랑 배수는 1~20 사이여야 합니다.",
  NOT_CONFIGURED: "Supabase 접속 정보가 설정되지 않았습니다. public/config.js 를 확인해 주세요.",
  ROWS_REQUIRED: "명단 데이터가 비어 있습니다.",
  EMPTY_LIST: "CSV 에서 읽어낸 주유소가 하나도 없습니다.",
  TOO_FEW_ROWS: "주유소가 10곳 미만입니다. 파일이 잘린 것은 아닌지 확인해 주세요.",
};

export function describeError(e: unknown): string {
  if (e instanceof RpcError) return MESSAGES[e.code] ?? e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** RPC 호출. 실패하면 RpcError 를 던진다. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg) throw new RpcError("NOT_CONFIGURED");

  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let msg = "";
    try {
      const body = await res.json();
      // PostgREST 는 raise exception 메시지를 message 에 담아 준다.
      msg = body?.message ?? body?.hint ?? "";
      const known = Object.keys(MESSAGES).find((k) => msg.includes(k));
      if (known) code = known;
    } catch {
      /* 본문이 JSON이 아니면 상태 코드만으로 처리한다 */
    }
    throw new RpcError(code, msg || `요청이 실패했습니다 (HTTP ${res.status})`);
  }

  return (await res.json()) as T;
}

// ── 세션 보관 ────────────────────────────────────────────────────────
// sessionStorage 를 쓴다. 탭을 닫으면 사라지고 다른 탭과도 섞이지 않는다.
const TOKEN_KEY = "gs_token";

export function saveToken(token: string) {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* 저장 불가여도 진행 */ }
}

export function loadToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
}

// ── API ──────────────────────────────────────────────────────────────

export interface StationRow {
  seq: number;
  name: string;
  address: string;
  sido: string;
  sigungu: string;
  sigungu_detail: string;
  region_key: string;
  station_id: string | null;
  /** 폴(상표) 코드 — HD / SOIL / SK / GS / AL / NH / EX / PB */
  brand: string | null;
  is_self: boolean;
  /** 선정차수 (예: "1차") */
  round: string | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  note: string;
  updated_at: string;
}

export interface AdminConfig {
  /** 서울·경기 초록 기준 순위 */
  rankGreenMetro: number;
  /** 그 밖의 시·도 초록 기준 순위 */
  rankGreenDefault: number;
  /** 노랑 구간 배수 */
  rankYellowFactor: number;
  updatedAt: string;
}

export interface SecretRow {
  name: string;
  note: string;
  isSet: boolean;
  hint: string;
  updatedAt: string;
}

export async function login(code: string): Promise<string> {
  const r = await rpc<{ token: string }>("gs_login", { p_code: code });
  saveToken(r.token);
  return r.token;
}

export async function ping(token: string): Promise<boolean> {
  try {
    await rpc("gs_ping", { p_token: token });
    return true;
  } catch {
    return false;
  }
}

export async function logout(token: string): Promise<void> {
  try { await rpc("gs_logout", { p_token: token }); } finally { clearToken(); }
}

export const listStations = (token: string) =>
  rpc<StationRow[]>("gs_stations", { p_token: token });

export const saveStation = (token: string, s: Partial<StationRow>) =>
  rpc<StationRow>("gs_station_save", {
    p_token: token,
    p_seq: s.seq ?? null,
    p_name: s.name ?? "",
    p_address: s.address ?? "",
    p_sido: s.sido ?? "",
    p_sigungu: s.sigungu ?? "",
    p_sigungu_detail: s.sigungu_detail ?? "",
    p_region_key: s.region_key ?? "",
    p_station_id: s.station_id ?? null,
    p_lat: s.lat ?? null,
    p_lng: s.lng ?? null,
    p_active: s.active ?? true,
    p_note: s.note ?? "",
  });

export const deleteStation = (token: string, seq: number) =>
  rpc("gs_station_delete", { p_token: token, p_seq: seq });

/** CSV 업로드 — 명단을 통째로 갈아끼운다. 좌표는 주유소코드로 이어받는다. */
export const replaceStations = (token: string, rows: Array<Record<string, unknown>>) =>
  rpc<{ ok: boolean; count: number; coords_kept: number }>("gs_station_replace", {
    p_token: token,
    p_rows: rows,
  });

export const getConfig = (token: string) =>
  rpc<AdminConfig>("gs_config_get", { p_token: token });

export const saveConfig = (token: string, c: AdminConfig) =>
  rpc("gs_config_save", {
    p_token: token,
    p_rank_green_metro: c.rankGreenMetro,
    p_rank_green_default: c.rankGreenDefault,
    p_rank_yellow_factor: c.rankYellowFactor,
  });

export const changeCode = (token: string, newCode: string) =>
  rpc("gs_code_change", { p_token: token, p_new_code: newCode });

export const listSecrets = (token: string) =>
  rpc<SecretRow[]>("gs_secrets", { p_token: token });

export const saveSecret = (token: string, name: string, value: string, note = "") =>
  rpc("gs_secret_save", { p_token: token, p_name: name, p_value: value, p_note: note });

export const deleteSecret = (token: string, name: string) =>
  rpc("gs_secret_delete", { p_token: token, p_name: name });
