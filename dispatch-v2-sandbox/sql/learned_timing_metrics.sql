-- Dispatch v2 learned timing metrics only.
-- Paste this whole file into Supabase SQL Editor.
-- Do not paste any app/lib/*.ts files into SQL Editor.

create table if not exists public.dispatch_stop_metrics (
  order_id text primary key references public.dispatch_orders(id) on delete cascade,
  route_id text references public.dispatch_routes(id) on delete set null,
  route_code text,
  order_number text,
  driver_id text,
  driver_name text,
  truck text,
  customer text,
  city text,
  material text,
  quantity numeric,
  unit text,
  stop_sequence integer,
  google_round_trip_minutes numeric,
  google_round_trip_miles numeric,
  google_one_way_minutes numeric,
  enroute_at timestamptz,
  delivered_at timestamptz,
  actual_drive_minutes numeric,
  actual_round_trip_estimate_minutes numeric,
  correction_factor numeric,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists dispatch_stop_metrics_route_idx
  on public.dispatch_stop_metrics (route_id, stop_sequence asc);

create index if not exists dispatch_stop_metrics_driver_city_idx
  on public.dispatch_stop_metrics (driver_name, city);

create index if not exists dispatch_stop_metrics_delivered_at_idx
  on public.dispatch_stop_metrics (delivered_at desc)
  where delivered_at is not null;

create or replace function public.set_dispatch_stop_metrics_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists dispatch_stop_metrics_set_updated_at on public.dispatch_stop_metrics;

create trigger dispatch_stop_metrics_set_updated_at
before update on public.dispatch_stop_metrics
for each row
execute function public.set_dispatch_stop_metrics_updated_at();
