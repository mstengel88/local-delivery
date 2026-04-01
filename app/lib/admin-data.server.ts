import { supabaseAdmin } from "./supabase.server";

export type OriginAddressRow = {
  id?: string;
  label: string;
  address: string;
  is_active: boolean;
};

export type ShippingMaterialRuleRow = {
  prefix: string;
  material_name: string;
  truck_capacity: number;
  vendor_source?: string | null;
  is_active: boolean;
  sort_order: number;
};

export async function getOriginAddresses(): Promise<OriginAddressRow[]> {
  const { data, error } = await supabaseAdmin
    .from("origin_addresses")
    .select("id, label, address, is_active")
    .order("label", { ascending: true });

  if (error) {
    console.error("[GET ORIGIN ADDRESSES ERROR]", error);
    return [];
  }

  return data || [];
}

export async function saveOriginAddress(row: OriginAddressRow) {
  const payload = {
    ...(row.id ? { id: row.id } : {}),
    label: row.label,
    address: row.address,
    is_active: row.is_active,
  };

  const { data, error } = await supabaseAdmin
    .from("origin_addresses")
    .upsert(payload, row.id ? { onConflict: "id" } : undefined)
    .select("*")
    .single();

  if (error) {
    console.error("[SAVE ORIGIN ADDRESS ERROR]", error);
    throw error;
  }

  return data;
}

export async function getShippingMaterialRules(): Promise<ShippingMaterialRuleRow[]> {
  const { data, error } = await supabaseAdmin
    .from("shipping_material_rules")
    .select("prefix, material_name, truck_capacity, vendor_source, is_active, sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[GET SHIPPING MATERIAL RULES ERROR]", error);
    return [];
  }

  return data || [];
}

export async function saveShippingMaterialRule(row: ShippingMaterialRuleRow) {
  const payload = {
    prefix: row.prefix,
    material_name: row.material_name,
    truck_capacity: row.truck_capacity,
    vendor_source: row.vendor_source || null,
    is_active: row.is_active,
    sort_order: row.sort_order,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("shipping_material_rules")
    .upsert(payload, { onConflict: "prefix" })
    .select("*")
    .single();

  if (error) {
    console.error("[SAVE SHIPPING MATERIAL RULE ERROR]", error);
    throw error;
  }

  return data;
}