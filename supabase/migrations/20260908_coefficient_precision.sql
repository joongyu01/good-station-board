begin;
alter table public.gs_daily alter column coefficient type numeric(10,4);
commit;
