-- Dispatch v2 photo storage
-- Run this in Supabase SQL Editor for the dispatch project.
-- New driver/order photos will be uploaded to this public bucket and only the
-- small URL will be stored in dispatch_orders.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dispatch-photos',
  'dispatch-photos',
  true,
  10485760,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read dispatch photos'
  ) then
    create policy "Public read dispatch photos"
      on storage.objects
      for select
      using (bucket_id = 'dispatch-photos');
  end if;
end $$;

-- Find old oversized embedded image rows that should be cleared after the new
-- code has been deployed.
select
  id,
  order_number,
  pg_size_pretty(pg_column_size(checklist_json)::bigint) as checklist_size,
  pg_size_pretty(pg_column_size(photo_urls)::bigint) as photo_size,
  updated_at
from public.dispatch_orders
where checklist_json is not null or photo_urls is not null
order by greatest(
  coalesce(pg_column_size(checklist_json), 0),
  coalesce(pg_column_size(photo_urls), 0)
) desc
limit 50;
