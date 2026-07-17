import { supabaseAdmin } from "./supabase.server";

export type SavedCustomQuote = {
  id: string;
  shop: string;
  customer_name?: string | null;
  company_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  shopify_company_id?: string | null;
  shopify_company_contact_id?: string | null;
  shopify_company_location_id?: string | null;
  payment_terms_name?: string | null;
  payment_terms_template_id?: string | null;
  payment_terms_due_in_days?: number | null;
  tax_exempt?: boolean | null;
  billing_address1?: string | null;
  billing_address2?: string | null;
  billing_city?: string | null;
  billing_province?: string | null;
  billing_postal_code?: string | null;
  billing_country?: string | null;
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
  created_by_user_id?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
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

function getCreatorPayload(input: {
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdByEmail?: string | null;
}) {
  return {
    created_by_user_id: input.createdByUserId || null,
    created_by_name: input.createdByName || null,
    created_by_email: input.createdByEmail || null,
  };
}

function isMissingCreatorColumnError(error: any) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    /created_by_(user_id|name|email)/i.test(message) ||
    /company_name|shopify_company|payment_terms|tax_exempt|billing_/i.test(message) ||
    /schema cache/i.test(message)
  );
}

export async function saveCustomQuote(input: {
  shop: string;
  customerName?: string;
  companyName?: string;
  customerEmail?: string;
  customerPhone?: string;
  shopifyCompanyId?: string;
  shopifyCompanyContactId?: string;
  shopifyCompanyLocationId?: string;
  paymentTermsName?: string;
  paymentTermsTemplateId?: string;
  paymentTermsDueInDays?: number | null;
  taxExempt?: boolean;
  billingAddress1?: string;
  billingAddress2?: string;
  billingCity?: string;
  billingProvince?: string;
  billingPostalCode?: string;
  billingCountry?: string;
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
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdByEmail?: string | null;
  sourceBreakdown: any[];
  lineItems: any[];
}) {
  const quotePayload = {
    shop: input.shop,
    customer_name: input.customerName || null,
    company_name: input.companyName || null,
    customer_email: input.customerEmail || null,
    customer_phone: input.customerPhone || null,
    shopify_company_id: input.shopifyCompanyId || null,
    shopify_company_contact_id: input.shopifyCompanyContactId || null,
    shopify_company_location_id: input.shopifyCompanyLocationId || null,
    payment_terms_name: input.paymentTermsName || null,
    payment_terms_template_id: input.paymentTermsTemplateId || null,
    payment_terms_due_in_days: input.paymentTermsDueInDays ?? null,
    tax_exempt: Boolean(input.taxExempt),
    billing_address1: input.billingAddress1 || null,
    billing_address2: input.billingAddress2 || null,
    billing_city: input.billingCity || null,
    billing_province: input.billingProvince || null,
    billing_postal_code: input.billingPostalCode || null,
    billing_country: input.billingCountry || null,
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
    ...getCreatorPayload(input),
    source_breakdown: input.sourceBreakdown,
    line_items: input.lineItems,
  };

  const { data, error } = await supabaseAdmin
    .from("custom_delivery_quotes")
    .insert(quotePayload)
    .select("id")
    .single();

  if (error) {
    if (isMissingCreatorColumnError(error)) {
      const {
        created_by_user_id,
        created_by_name,
        created_by_email,
        company_name,
        shopify_company_id,
        shopify_company_contact_id,
        shopify_company_location_id,
        payment_terms_name,
        payment_terms_template_id,
        payment_terms_due_in_days,
        tax_exempt,
        billing_address1,
        billing_address2,
        billing_city,
        billing_province,
        billing_postal_code,
        billing_country,
        ...fallbackPayload
      } =
        quotePayload;
      const fallback = await supabaseAdmin
        .from("custom_delivery_quotes")
        .insert(fallbackPayload)
        .select("id")
        .single();

      if (!fallback.error) {
        console.warn(
          "[SAVE CUSTOM QUOTE WARNING] Creator columns missing. Run supabase_quote_creator_schema.sql.",
        );
        return fallback.data;
      }

      console.error("[SAVE CUSTOM QUOTE FALLBACK ERROR]", fallback.error);
    }

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

export async function updateCustomQuote(
  id: string,
  input: {
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
    shippingDetails?: string | null;
    description?: string;
    eta?: string;
    summary?: string;
    sourceBreakdown: any[];
    lineItems: any[];
  },
) {
  const { data, error } = await supabaseAdmin
    .from("custom_delivery_quotes")
    .update({
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
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[UPDATE CUSTOM QUOTE ERROR]", error);
    throw error;
  }

  return data as SavedCustomQuote;
}
