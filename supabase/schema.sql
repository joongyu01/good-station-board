-- ═══════════════════════════════════════════════════════════════════════════
--  착한주유소 현황판 — Supabase 스키마
--
--  Supabase 대시보드 → SQL Editor → 새 쿼리 → 이 파일 전체를 붙여넣고 [Run]
--  두 번 실행해도 안전합니다(멱등).
--
--  접근 모델: 계정 없이 **접근코드 하나**로만 들어옵니다. 기본값 'kpetro'.
--    나중에 바꾸려면 아래 INSERT를 고치는 게 아니라(멱등이라 무시됨) 이 한 줄:
--      update gs_config set access_code = '새코드' where id = 1;
-- ═══════════════════════════════════════════════════════════════════════════

-- pgcrypto(gen_random_bytes) — Supabase 는 이 확장을 public 이 아니라 extensions
-- 스키마에 설치한다. 그래서 아래 모든 함수의 search_path 에 extensions 를 포함시킨다.
create extension if not exists pgcrypto;

-- ═══════════════════ 테이블 ═══════════════════

-- 운영 설정. 임계값을 여기서 바꾸면 다음 집계부터 반영된다.
create table if not exists gs_config (
  id           smallint primary key default 1,
  access_code  text        not null,
  -- 신호등 임계값 (원/L). 지역 최저가 + 이 값까지는 '근접'(노랑).
  gap_yellow   integer     not null default 20,
  -- 시·군·구 표본이 이보다 적으면 표준편차를 시·도 값으로 대체한다.
  min_sample   integer     not null default 5,
  -- 최저가 판정에 필요한 최소 주유소 수. 1이면 자동으로 최저가가 되어버린다.
  min_compare  integer     not null default 2,
  updated_at   timestamptz not null default now(),
  constraint gs_config_one_row check (id = 1)
);

insert into gs_config (id, access_code) values (1, 'kpetro')
on conflict (id) do nothing;

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 외부 API 키 보관                                                        │
-- │                                                                         │
-- │ 값(value)은 **브라우저로 절대 내려보내지 않는다.** 관리 화면에서는       │
-- │ 이름·설정여부·수정시각만 보이고, 실제 값은 GitHub Actions 가            │
-- │ service_role 키로 직접 읽어간다. 접근코드가 유출되어도 API 키까지        │
-- │ 함께 새지는 않게 하기 위함이다.                                         │
-- └─────────────────────────────────────────────────────────────────────────┘
create table if not exists gs_secret (
  name       text        primary key,           -- 예: OPINET_API_KEY
  value      text        not null,
  note       text        not null default '',
  updated_at timestamptz not null default now()
);

-- 착한주유소 명단. adress.csv 를 대체한다.
create table if not exists gs_station (
  seq            integer     primary key,       -- 명단 순번. 기존 JSON 과 같은 키.
  name           text        not null,
  address        text        not null,
  sido           text        not null default '',
  sigungu        text        not null default '',
  sigungu_detail text        not null default '',
  region_key     text        not null default '',
  -- 오피넷 주유소 코드. 자동 매칭이 실패하면 여기에 사람이 직접 적는다.
  station_id     text,
  -- 좌표 수기 보정. 채워두면 자동 수집 결과보다 우선한다.
  lat            double precision,
  lng            double precision,
  active         boolean     not null default true,
  note           text        not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists gs_station_region_idx on gs_station (sido, sigungu);
create index if not exists gs_station_active_idx on gs_station (active);

-- 일별 판정 결과 — **착한주유소 것만** 넣는다.
--
-- 전국 1만 건을 매일 넣으면 연 370만 행이라 무료 한도(500MB)를 넘는다.
-- 원본은 GitHub Actions 안에서만 쓰고 버리고, 여기에는 449곳 × 4유종만 남긴다.
create table if not exists gs_daily (
  trade_date  date        not null,
  seq         integer     not null,
  fuel_type   text        not null,
  price       integer,
  region_min  integer,
  region_mean numeric(10,2),
  gap_from_min integer,
  signal      text        not null default 'unknown',
  region_rank integer,
  region_n    integer     not null default 0,
  created_at  timestamptz not null default now(),
  primary key (trade_date, seq, fuel_type),
  constraint gs_daily_signal check (signal in ('green', 'yellow', 'red', 'unknown'))
);

create index if not exists gs_daily_date_idx   on gs_daily (trade_date desc);
create index if not exists gs_daily_signal_idx on gs_daily (trade_date, signal);

create table if not exists gs_session (
  token      text        primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ═══════════════════ RLS: 직접 접근 전면 차단 ═══════════════════
-- 정책을 하나도 만들지 않는다 = anon 키로는 테이블을 읽지도 쓰지도 못한다.
-- 모든 접근은 아래 SECURITY DEFINER 함수를 통해서만 이뤄진다.
-- (그래서 접근코드와 API 키는 브라우저로 내려오지 않는다)

alter table gs_config  enable row level security;
alter table gs_secret  enable row level security;
alter table gs_station enable row level security;
alter table gs_daily   enable row level security;
alter table gs_session enable row level security;

-- ═══════════════════ 내부 헬퍼 ═══════════════════

create or replace function gs_gate(p_code text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_code is null or not exists (
    select 1 from gs_config where id = 1 and access_code = p_code
  ) then
    raise exception 'INVALID_CODE' using errcode = '28000';
  end if;
end;
$$;

-- 세션 확인. 만료된 세션은 지나가는 김에 청소한다.
create or replace function gs_require_session(p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from gs_session where expires_at < now();

  if p_token is null or not exists (
    select 1 from gs_session where token = p_token and expires_at > now()
  ) then
    raise exception 'NO_SESSION' using errcode = '28000';
  end if;
end;
$$;

-- ═══════════════════ 공개 API (anon 키로 호출) ═══════════════════

-- ① 로그인 — 접근코드만 맞으면 8시간짜리 세션을 준다.
create or replace function gs_login(p_code text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_exp   timestamptz := now() + interval '8 hours';
begin
  perform gs_gate(p_code);
  insert into gs_session (token, expires_at) values (v_token, v_exp);
  return json_build_object('ok', true, 'token', v_token, 'expiresAt', v_exp);
end;
$$;

-- ② 세션 연장 확인 — 화면 진입 때 토큰이 아직 유효한지 본다.
create or replace function gs_ping(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_exp timestamptz;
begin
  perform gs_require_session(p_token);
  select expires_at into v_exp from gs_session where token = p_token;
  return json_build_object('ok', true, 'expiresAt', v_exp);
end;
$$;

create or replace function gs_logout(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from gs_session where token = p_token;
  return json_build_object('ok', true);
end;
$$;

-- ③ 명단 조회
create or replace function gs_stations(p_token text)
returns setof gs_station
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform gs_require_session(p_token);
  return query select * from gs_station order by seq;
end;
$$;

-- ④ 명단 저장 (신규/수정 겸용)
--
-- p_seq 가 null 이면 새 번호를 자동으로 매긴다. 지역 필드(sido/sigungu 등)는
-- 주소에서 파생되는 값이라 서버에서 만들지 않고, 화면에서 정규화한 결과를 받는다.
-- 정규화 규칙이 src/lib/region.ts 한 곳에만 있어야 파이프라인과 어긋나지 않는다.
create or replace function gs_station_save(
  p_token          text,
  p_seq            integer,
  p_name           text,
  p_address        text,
  p_sido           text default '',
  p_sigungu        text default '',
  p_sigungu_detail text default '',
  p_region_key     text default '',
  p_station_id     text default null,
  p_lat            double precision default null,
  p_lng            double precision default null,
  p_active         boolean default true,
  p_note           text default ''
)
returns gs_station
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_seq integer := p_seq;
  v_row gs_station;
begin
  perform gs_require_session(p_token);

  if p_name is null or btrim(p_name) = '' then
    raise exception 'NAME_REQUIRED' using errcode = '22000';
  end if;
  if p_address is null or btrim(p_address) = '' then
    raise exception 'ADDRESS_REQUIRED' using errcode = '22000';
  end if;

  if v_seq is null then
    select coalesce(max(seq), 0) + 1 into v_seq from gs_station;
  end if;

  insert into gs_station (
    seq, name, address, sido, sigungu, sigungu_detail, region_key,
    station_id, lat, lng, active, note
  ) values (
    v_seq, btrim(p_name), btrim(p_address), p_sido, p_sigungu, p_sigungu_detail, p_region_key,
    nullif(btrim(coalesce(p_station_id, '')), ''), p_lat, p_lng, p_active, coalesce(p_note, '')
  )
  on conflict (seq) do update set
    name           = excluded.name,
    address        = excluded.address,
    sido           = excluded.sido,
    sigungu        = excluded.sigungu,
    sigungu_detail = excluded.sigungu_detail,
    region_key     = excluded.region_key,
    station_id     = excluded.station_id,
    lat            = excluded.lat,
    lng            = excluded.lng,
    active         = excluded.active,
    note           = excluded.note,
    updated_at     = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ⑤ 명단 삭제
create or replace function gs_station_delete(p_token text, p_seq integer)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform gs_require_session(p_token);
  delete from gs_station where seq = p_seq;
  return json_build_object('ok', true, 'seq', p_seq);
end;
$$;

-- ⑥ 설정 조회/저장 — access_code 는 돌려주지 않는다.
create or replace function gs_config_get(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v json;
begin
  perform gs_require_session(p_token);
  select json_build_object(
    'gapYellow', gap_yellow,
    'minSample', min_sample,
    'minCompare', min_compare,
    'updatedAt', updated_at
  ) into v from gs_config where id = 1;
  return v;
end;
$$;

create or replace function gs_config_save(
  p_token       text,
  p_gap_yellow  integer,
  p_min_sample  integer,
  p_min_compare integer
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform gs_require_session(p_token);

  if p_gap_yellow < 0 or p_gap_yellow > 500 then
    raise exception 'GAP_RANGE' using errcode = '22000';
  end if;
  if p_min_sample < 1 or p_min_compare < 1 then
    raise exception 'MIN_RANGE' using errcode = '22000';
  end if;

  update gs_config set
    gap_yellow  = p_gap_yellow,
    min_sample  = p_min_sample,
    min_compare = p_min_compare,
    updated_at  = now()
  where id = 1;

  return json_build_object('ok', true);
end;
$$;

-- ⑦ 접근코드 변경
create or replace function gs_code_change(p_token text, p_new_code text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform gs_require_session(p_token);

  if p_new_code is null or length(btrim(p_new_code)) < 4 then
    raise exception 'CODE_TOO_SHORT' using errcode = '22000';
  end if;

  update gs_config set access_code = btrim(p_new_code), updated_at = now() where id = 1;
  -- 코드가 바뀌면 기존 세션도 모두 끊는다.
  delete from gs_session;

  return json_build_object('ok', true);
end;
$$;

-- ⑧ API 키 목록 — **값은 내려보내지 않는다.** 설정 여부만 알려준다.
create or replace function gs_secrets(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v json;
begin
  perform gs_require_session(p_token);
  select coalesce(json_agg(json_build_object(
    'name', name,
    'note', note,
    'isSet', length(btrim(value)) > 0,
    'hint', case when length(value) > 8
                 then left(value, 4) || repeat('*', 6) || right(value, 4)
                 else repeat('*', 8) end,
    'updatedAt', updated_at
  ) order by name), '[]'::json) into v from gs_secret;
  return v;
end;
$$;

create or replace function gs_secret_save(p_token text, p_name text, p_value text, p_note text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform gs_require_session(p_token);

  if p_name is null or btrim(p_name) = '' then
    raise exception 'NAME_REQUIRED' using errcode = '22000';
  end if;

  insert into gs_secret (name, value, note)
  values (btrim(p_name), coalesce(p_value, ''), coalesce(p_note, ''))
  on conflict (name) do update set
    value = excluded.value, note = excluded.note, updated_at = now();

  return json_build_object('ok', true);
end;
$$;

create or replace function gs_secret_delete(p_token text, p_name text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform gs_require_session(p_token);
  delete from gs_secret where name = p_name;
  return json_build_object('ok', true);
end;
$$;

-- ═══════════════════ 권한 ═══════════════════
-- 함수 실행만 열어준다. 테이블은 RLS 로 막혀 있어 여전히 직접 접근이 불가능하다.

grant execute on function gs_login(text)            to anon, authenticated;
grant execute on function gs_ping(text)             to anon, authenticated;
grant execute on function gs_logout(text)           to anon, authenticated;
grant execute on function gs_stations(text)         to anon, authenticated;
grant execute on function gs_station_save(text, integer, text, text, text, text, text, text, text, double precision, double precision, boolean, text) to anon, authenticated;
grant execute on function gs_station_delete(text, integer)          to anon, authenticated;
grant execute on function gs_config_get(text)                        to anon, authenticated;
grant execute on function gs_config_save(text, integer, integer, integer) to anon, authenticated;
grant execute on function gs_code_change(text, text)                 to anon, authenticated;
grant execute on function gs_secrets(text)                           to anon, authenticated;
grant execute on function gs_secret_save(text, text, text, text)     to anon, authenticated;
grant execute on function gs_secret_delete(text, text)               to anon, authenticated;

-- 내부 헬퍼는 노출하지 않는다.
revoke execute on function gs_gate(text)            from anon, authenticated;
revoke execute on function gs_require_session(text) from anon, authenticated;
