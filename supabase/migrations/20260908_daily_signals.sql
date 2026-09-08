-- Supabase SQL Editor에서 실행. 기존 일별 가격 행은 보존한다.
begin;
alter table public.gs_daily drop constraint if exists gs_daily_signal;
alter table public.gs_daily add constraint gs_daily_signal
  check (signal in ('green', 'yellow', 'red', 'unknown', 'stale', 'cancel'));
commit;
