import { supabaseAdmin } from "./supabase.server";

export async function saveCustomQuote(input: {
  shop: string;
  customerName?: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  quoteTotalCents: number;
  serviceName?: string;
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
      address1: input.address1,
      address2: input.address2 || null,
      city: input.city,
      province: input.province,
      postal_code: input.postalCode,
      country: input.country,
      quote_total_cents: input.quoteTotalCents,
      service_name: input.serviceName || null,
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