-- Fix Supabase advisor warning: RLS disabled on public.dispatch_b2b_companies.
-- Run this in the dispatch Supabase SQL Editor.
--
-- The app uses the service role key on the server, which bypasses RLS.
-- These policies protect direct browser/PostgREST access while still allowing
-- authenticated dispatch users to search contractor companies.

alter table public.dispatch_b2b_companies enable row level security;

drop policy if exists "Dispatch users can read B2B companies" on public.dispatch_b2b_companies;
create policy "Dispatch users can read B2B companies"
on public.dispatch_b2b_companies
for select
to authenticated
using (
  exists (
    select 1
    from public.dispatch_user_roles role
    where role.user_id = auth.uid()
      and role.is_active = true
  )
);

drop policy if exists "Dispatch admins can insert B2B companies" on public.dispatch_b2b_companies;
create policy "Dispatch admins can insert B2B companies"
on public.dispatch_b2b_companies
for insert
to authenticated
with check (
  exists (
    select 1
    from public.dispatch_user_roles role
    where role.user_id = auth.uid()
      and role.is_active = true
      and (
        role.role = 'admin'
        or 'settings' = any(role.permissions)
        or 'imports' = any(role.permissions)
      )
  )
);

drop policy if exists "Dispatch admins can update B2B companies" on public.dispatch_b2b_companies;
create policy "Dispatch admins can update B2B companies"
on public.dispatch_b2b_companies
for update
to authenticated
using (
  exists (
    select 1
    from public.dispatch_user_roles role
    where role.user_id = auth.uid()
      and role.is_active = true
      and (
        role.role = 'admin'
        or 'settings' = any(role.permissions)
        or 'imports' = any(role.permissions)
      )
  )
)
with check (
  exists (
    select 1
    from public.dispatch_user_roles role
    where role.user_id = auth.uid()
      and role.is_active = true
      and (
        role.role = 'admin'
        or 'settings' = any(role.permissions)
        or 'imports' = any(role.permissions)
      )
  )
);

drop policy if exists "Dispatch admins can delete B2B companies" on public.dispatch_b2b_companies;
create policy "Dispatch admins can delete B2B companies"
on public.dispatch_b2b_companies
for delete
to authenticated
using (
  exists (
    select 1
    from public.dispatch_user_roles role
    where role.user_id = auth.uid()
      and role.is_active = true
      and (
        role.role = 'admin'
        or 'settings' = any(role.permissions)
        or 'imports' = any(role.permissions)
      )
  )
);
