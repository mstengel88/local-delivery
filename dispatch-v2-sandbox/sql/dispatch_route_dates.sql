alter table public.dispatch_routes
  add column if not exists dispatch_date date;

update public.dispatch_routes
set dispatch_date = (created_at at time zone 'America/Chicago')::date
where dispatch_date is null;

create index if not exists dispatch_routes_dispatch_date_idx
  on public.dispatch_routes (dispatch_date)
  where is_active = true;
