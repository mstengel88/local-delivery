create table if not exists public.quote_tax_rate_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  city text,
  province text,
  postal_code text,
  country text,
  address1 text,
  rate numeric(8,6) not null,
  label text not null default 'Shopify tax',
  source text not null default 'shopify',
  sample_taxable_amount numeric(10,2) not null default 100.00,
  shopify_total_tax numeric(10,2),
  calculated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_tax_rate_cache_lookup_idx
  on public.quote_tax_rate_cache (cache_key, expires_at);

alter table public.quote_tax_rate_cache enable row level security;
