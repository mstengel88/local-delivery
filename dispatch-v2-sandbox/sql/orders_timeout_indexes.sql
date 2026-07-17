-- Dispatch v2 Orders timeout fix
-- Run this in Supabase SQL Editor if /orders reports:
-- "canceling statement due to statement timeout"

create index if not exists dispatch_orders_updated_created_idx
  on public.dispatch_orders (updated_at desc, created_at desc);

create index if not exists dispatch_orders_status_updated_idx
  on public.dispatch_orders (status, updated_at desc);

create index if not exists dispatch_orders_delivery_status_delivered_idx
  on public.dispatch_orders (delivery_status, delivered_at desc, updated_at desc);

create index if not exists dispatch_orders_assigned_status_idx
  on public.dispatch_orders (assigned_route_id, status, delivery_status)
  where assigned_route_id is not null;

create extension if not exists pg_trgm;

create index if not exists dispatch_orders_order_number_trgm_idx
  on public.dispatch_orders using gin (order_number gin_trgm_ops);

create index if not exists dispatch_orders_customer_trgm_idx
  on public.dispatch_orders using gin (customer gin_trgm_ops);

create index if not exists dispatch_orders_contact_trgm_idx
  on public.dispatch_orders using gin (contact gin_trgm_ops);

create index if not exists dispatch_orders_address_trgm_idx
  on public.dispatch_orders using gin (address gin_trgm_ops);

create index if not exists dispatch_orders_city_trgm_idx
  on public.dispatch_orders using gin (city gin_trgm_ops);

create index if not exists dispatch_orders_material_trgm_idx
  on public.dispatch_orders using gin (material gin_trgm_ops);

create index if not exists dispatch_orders_requested_window_trgm_idx
  on public.dispatch_orders using gin (requested_window gin_trgm_ops);

analyze public.dispatch_orders;

notify pgrst, 'reload schema';
