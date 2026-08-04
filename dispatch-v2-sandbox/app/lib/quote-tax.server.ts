import { createClient } from "@supabase/supabase-js";
import type { RealtimeClientOptions } from "@supabase/realtime-js";
import WebSocket from "ws";
import {
  getQuoteTaxRateForAddress,
  type QuoteTaxAddress,
  type QuoteTaxRateMatch,
} from "./quote-tax";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SHOPIFY_SHOP_DOMAIN = (
  process.env.SHOPIFY_SHOP_DOMAIN ||
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.SHOPIFY_SHOP ||
  ""
).trim();
const SHOPIFY_ADMIN_ACCESS_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
const SHOPIFY_API_KEY = (process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID || "").trim();
const SHOPIFY_API_SECRET = (
  process.env.SHOPIFY_API_SECRET ||
  process.env.SHOPIFY_API_SECRET_KEY ||
  process.env.SHOPIFY_CLIENT_SECRET ||
  process.env.SHOPIFY_CLIENT_SECRET_KEY ||
  ""
).trim();
const SHOPIFY_API_VERSION = (process.env.SHOPIFY_API_VERSION || "2026-01").trim();
const SAMPLE_TAXABLE_AMOUNT = 100;

let cachedShopifyAccessToken = "";
let cachedShopifyAccessTokenExpiresAt = 0;

const supabaseRealtimeTransport = WebSocket as unknown as NonNullable<
  RealtimeClientOptions["transport"]
>;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
        realtime: { transport: supabaseRealtimeTransport },
      })
    : null;

function normalizeShopDomain(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

function normalizeText(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizePostalCode(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function parsePostalCode(address: QuoteTaxAddress) {
  const direct = normalizePostalCode(address.postalCode);
  if (direct) return direct;

  const combined = [address.address1, address.address2, address.city]
    .filter(Boolean)
    .join(" ");
  const match = combined.match(/\b\d{5}(?:-\d{4})?\b/);
  return match ? normalizePostalCode(match[0]) : "";
}

function parseCity(address: QuoteTaxAddress) {
  const direct = String(address.city || "").trim();
  if (direct) return direct.split(",")[0]?.trim() || direct;

  const parts = [address.address1, address.address2]
    .filter(Boolean)
    .join(", ")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

function addressCacheKey(address: QuoteTaxAddress) {
  const city = normalizeText(parseCity(address));
  const province = normalizeText(address.province || "WI");
  const postalCode = parsePostalCode(address);
  const country = normalizeText(address.country || "US");
  const address1 = normalizeText(address.address1);

  return [country, province, postalCode, city, address1].filter(Boolean).join("|");
}

function taxFallback(address: QuoteTaxAddress): QuoteTaxRateMatch {
  return getQuoteTaxRateForAddress(address);
}

async function getShopifyAccessToken() {
  if (SHOPIFY_ADMIN_ACCESS_TOKEN) return SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!SHOPIFY_SHOP_DOMAIN || !SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    throw new Error("Missing Shopify credentials for tax lookup.");
  }

  const now = Date.now();
  if (cachedShopifyAccessToken && cachedShopifyAccessTokenExpiresAt > now + 60_000) {
    return cachedShopifyAccessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
  });

  const response = await fetch(`https://${normalizeShopDomain(SHOPIFY_SHOP_DOMAIN)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Shopify token request failed with HTTP ${response.status}.`);
  }

  cachedShopifyAccessToken = payload.access_token;
  cachedShopifyAccessTokenExpiresAt = now + Number(payload.expires_in || 86400) * 1000;
  return cachedShopifyAccessToken;
}

async function shopifyTaxGraphql<T>(query: string, variables: Record<string, unknown>) {
  if (!SHOPIFY_SHOP_DOMAIN) throw new Error("Missing SHOPIFY_SHOP_DOMAIN.");
  const accessToken = await getShopifyAccessToken();
  const response = await fetch(
    `https://${normalizeShopDomain(SHOPIFY_SHOP_DOMAIN)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const body = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string | null }>;
  };

  if (!response.ok || body.errors?.length) {
    const message = body.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || `Shopify GraphQL failed with HTTP ${response.status}.`);
  }

  return body.data as T;
}

async function calculateShopifyTaxRate(address: QuoteTaxAddress) {
  const city = parseCity(address);
  const province = String(address.province || "WI").trim();
  const zip = parsePostalCode(address);
  const country = String(address.country || "US").trim() || "US";

  if (!city || !province || !zip) return null;

  const query = `#graphql
    mutation CalculateQuoteTax($input: DraftOrderInput!) {
      draftOrderCalculate(input: $input) {
        calculatedDraftOrder {
          totalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyTaxGraphql<{
    draftOrderCalculate?: {
      calculatedDraftOrder?: {
        totalTaxSet?: {
          shopMoney?: {
            amount?: string | null;
            currencyCode?: string | null;
          } | null;
        } | null;
      } | null;
      userErrors?: Array<{ field?: string[] | null; message?: string | null }> | null;
    } | null;
  }>(query, {
    input: {
      lineItems: [
        {
          title: "Quote Tax Rate Check",
          quantity: 1,
          originalUnitPriceWithCurrency: {
            amount: SAMPLE_TAXABLE_AMOUNT.toFixed(2),
            currencyCode: "USD",
          },
          requiresShipping: true,
          taxable: true,
        },
      ],
      shippingAddress: {
        address1: String(address.address1 || "123 Main St").trim(),
        address2: String(address.address2 || "").trim(),
        city,
        province,
        zip,
        country,
      },
    },
  });

  const result = data.draftOrderCalculate;
  const errors = result?.userErrors?.map((error) => error.message).filter(Boolean) || [];
  if (errors.length) {
    throw new Error(errors.join("; "));
  }

  const taxAmount = Number(result?.calculatedDraftOrder?.totalTaxSet?.shopMoney?.amount || 0);
  if (!Number.isFinite(taxAmount) || taxAmount < 0) return null;

  return Math.round((taxAmount / SAMPLE_TAXABLE_AMOUNT) * 1000000) / 1000000;
}

async function readCachedTaxRate(cacheKey: string): Promise<QuoteTaxRateMatch | null> {
  if (!supabase || !cacheKey) return null;

  const { data, error } = await supabase
    .from("quote_tax_rate_cache")
    .select("rate,label,source,expires_at")
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.warn("[QUOTE TAX CACHE READ ERROR]", error);
    return null;
  }

  if (!data) return null;
  const rate = Number(data.rate);
  if (!Number.isFinite(rate) || rate < 0) return null;

  return {
    rate,
    label: String(data.label || "Shopify tax"),
    matchedRule: true,
  };
}

async function writeCachedTaxRate(cacheKey: string, address: QuoteTaxAddress, rate: number) {
  if (!supabase || !cacheKey) return;

  const { error } = await supabase
    .from("quote_tax_rate_cache")
    .upsert(
      {
        cache_key: cacheKey,
        city: parseCity(address) || null,
        province: String(address.province || "WI").trim() || null,
        postal_code: parsePostalCode(address) || null,
        country: String(address.country || "US").trim() || null,
        address1: String(address.address1 || "").trim() || null,
        rate,
        label: "Shopify tax",
        source: "shopify",
        sample_taxable_amount: SAMPLE_TAXABLE_AMOUNT,
        shopify_total_tax: Math.round(rate * SAMPLE_TAXABLE_AMOUNT * 100) / 100,
        calculated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" },
    );

  if (error) {
    console.warn("[QUOTE TAX CACHE WRITE ERROR]", error);
  }
}

export async function getBestQuoteTaxRateForAddress(
  address: QuoteTaxAddress,
): Promise<QuoteTaxRateMatch> {
  const fallback = taxFallback(address);
  const cacheKey = addressCacheKey(address);
  if (!cacheKey) return fallback;

  const cached = await readCachedTaxRate(cacheKey);
  if (cached) return cached;

  try {
    const shopifyRate = await calculateShopifyTaxRate(address);
    if (shopifyRate === null) return fallback;

    await writeCachedTaxRate(cacheKey, address, shopifyRate);
    return {
      rate: shopifyRate,
      label: "Shopify tax",
      matchedRule: true,
    };
  } catch (error) {
    console.warn("[QUOTE SHOPIFY TAX LOOKUP ERROR]", error);
    return fallback;
  }
}
