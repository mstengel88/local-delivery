-- Adds paver/pallet delivery rule support for the live and v2 quote engines.
-- Run this in the Supabase SQL Editor for the quote-tool database.

alter table public.shipping_material_rules
  add column if not exists delivery_mode text not null default 'bulk',
  add column if not exists capacity_unit text not null default 'quantity';

alter table public.product_source_map
  add column if not exists weight_grams numeric;

alter table public.shipping_material_rules
  drop constraint if exists shipping_material_rules_delivery_mode_check,
  add constraint shipping_material_rules_delivery_mode_check
    check (delivery_mode in ('bulk', 'paver'));

alter table public.shipping_material_rules
  drop constraint if exists shipping_material_rules_capacity_unit_check,
  add constraint shipping_material_rules_capacity_unit_check
    check (capacity_unit in ('quantity', 'weight_lb'));

comment on column public.shipping_material_rules.delivery_mode is
  'bulk keeps standard material load logic. paver enables paver/pallet delivery wording and grouping.';

comment on column public.shipping_material_rules.capacity_unit is
  'quantity uses Shopify line quantity/pallet count for truck_capacity. weight_lb uses line item grams converted to pounds.';

comment on column public.product_source_map.weight_grams is
  'Shopify variant weight stored in grams for quote rules that use capacity_unit = weight_lb.';

-- Example only. Uncomment and adjust the prefix/capacity once you confirm the paver SKU prefix.
-- update public.shipping_material_rules
-- set delivery_mode = 'paver',
--     capacity_unit = 'weight_lb',
--     truck_capacity = 26000,
--     material_name = 'Paver'
-- where prefix = '200';
