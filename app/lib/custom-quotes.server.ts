import { supabaseAdmin } from "./supabase.server";

export type SavedCustomQuote = {
  id: string;
  shop: string;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  address1: string;
  address2?: string | null;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  quote_total_cents: number;
  service_name?: string | null;
  shipping_details?: string | null;
  description?: string | null;
  eta?: string | null;
  summary?: string | null;
  source_breakdown?: unknown[] | null;
  line_items?: Array<{
    title: string;
    sku: string;
    quantity: number;
    vendor?: string;
    price?: number;
    variantId?: string | null;
    pricingLabel?: string;
    audience?: string;
    contractorTier?: string | null;
  }> | null;
  created_at: string;
};

export async function saveCustomQuote(input: {
  shop: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  quoteTotalCents: number;
  serviceName?: string;
  shippingDetails?: string;
  description?: string;
  eta?: string;
  summary?: string;
  sourceBreakdown: any[];
  lineItems: any[];
}) {
  const { data, error } = await supabaseAdmin
    .from("custom_delivery_quotes")
    .insert({
      shop: input.shop,
      customer_name: input.customerName || null,
      customer_email: input.customerEmail || null,
      customer_phone: input.customerPhone || null,
      address1: input.address1,
      address2: input.address2 || null,
      city: input.city,
      province: input.province,
      postal_code: input.postalCode,
      country: input.country,
      quote_total_cents: input.quoteTotalCents,
      service_name: input.serviceName || null,
      shipping_details: input.shippingDetails || null,
      description: input.description || null,
      eta: input.eta || null,
      summary: input.summary || null,
      source_breakdown: input.sourceBreakdown,
      line_items: input.lineItems,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[SAVE CUSTOM QUOTE ERROR]", error);
    throw error;
  }

  return data;
}

export async function getRecentCustomQuotes(limit = 20) {
  const { data, error } = await supabaseAdmin
    .from("custom_delivery_quotes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[GET RECENT CUSTOM QUOTES ERROR]", error);
    return [];
  }

  return data || [];
}

export async function getCustomQuoteById(id: string) {
  const { data, error } = await supabaseAdmin
    .from("custom_delivery_quotes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[GET CUSTOM QUOTE ERROR]", error);
    return null;
  }

  return (data as SavedCustomQuote | null) || null;
}

export async function deleteCustomQuote(id: string) {
  const { error } = await supabaseAdmin
    .from("custom_delivery_quotes")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[DELETE CUSTOM QUOTE ERROR]", error);
    throw error;
  }

  return { id };
}
