-- Driver directory + one-place Supabase user linking.
-- Run this in the dispatch Supabase SQL Editor.

alter table public.dispatch_employees
  add column if not exists phone text,
  add column if not exists user_id uuid,
  add column if not exists user_email text,
  add column if not exists notes text;

create unique index if not exists dispatch_employees_user_id_unique
  on public.dispatch_employees (user_id)
  where user_id is not null;

create index if not exists dispatch_employees_user_email_idx
  on public.dispatch_employees (lower(user_email))
  where user_email is not null;

create index if not exists dispatch_employees_active_idx
  on public.dispatch_employees (is_active);
