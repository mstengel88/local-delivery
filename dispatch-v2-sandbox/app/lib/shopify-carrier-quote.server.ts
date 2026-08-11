const DEFAULT_CARRIER_RATE_URL =
  "https://shipcalc.ghstickets.com/api/carrier-service";

export type ShopifyCarrierQuoteItem = {
  variantId?: string | null;
  sku?: string;
  quantity: number;
  grams?: number;
  vendor?: string;
};

export type ShopifyCarrierQuoteInput = {
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  currency?: string;
  items: ShopifyCarrierQuoteItem[];
};

export type ShopifyCarrierQuoteResult = {
  cents: number;
  serviceName: string;
  serviceCode: string;
  description: string;
  eta: string;
  summary: string;
};

type CarrierRate = {
  service_name?: string;
  service_code?: string;
  total_price?: string | number;
  description?: string;
  currency?: string;
  min_delivery_date?: string;
  max_delivery_date?: string;
};

function toLegacyVariantId(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;

  const match = normalized.match(/(?:ProductVariant\/)?(\d+)$/);
  return match?.[1];
}

function buildEta(rate: CarrierRate) {
  const minimum = String(rate.min_delivery_date || "").trim();
  const maximum = String(rate.max_delivery_date || "").trim();

  if (minimum && maximum && minimum !== maximum) return `${minimum} - ${maximum}`;
  return minimum || maximum || "Calculated by GHS Shipping Calc";
}

export async function getShopifyCarrierQuote(
  input: ShopifyCarrierQuoteInput,
): Promise<ShopifyCarrierQuoteResult> {
  const missingVariantSkus = input.items
    .filter((item) => !toLegacyVariantId(item.variantId))
    .map((item) => item.sku || "unknown SKU");
  if (missingVariantSkus.length) {
    throw new Error(
      `Shopify variant ID is missing for: ${missingVariantSkus.join(", ")}. Refresh products before calculating delivery.`,
    );
  }

  const carrierRateUrl =
    process.env.SHOPIFY_CARRIER_RATE_URL?.trim() || DEFAULT_CARRIER_RATE_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(carrierRateUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rate: {
          destination: {
            address1: input.address1,
            address2: input.address2 || "",
            city: input.city,
            province: input.province,
            postal_code: input.postalCode,
            country: input.country || "US",
          },
          items: input.items.map((item) => ({
            variant_id: toLegacyVariantId(item.variantId)!,
            quantity: Number(item.quantity || 0),
            sku: item.sku || "",
            grams: Math.max(0, Math.round(Number(item.grams || 0))),
            vendor: item.vendor || "",
            requires_shipping: true,
          })),
          currency: input.currency || "USD",
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `GHS Shipping Calc returned ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    const payload = (await response.json()) as { rates?: CarrierRate[] };
    const rates = Array.isArray(payload.rates) ? payload.rates : [];
    const rate =
      rates.find((candidate) => candidate.service_name === "GHS Delivery") ||
      rates[0];

    if (!rate) {
      throw new Error("GHS Shipping Calc did not return an available delivery rate.");
    }

    const cents = Number(rate.total_price);
    if (!Number.isFinite(cents) || cents < 0) {
      throw new Error("GHS Shipping Calc returned an invalid delivery price.");
    }

    const serviceName = rate.service_name || "GHS Delivery";
    const description =
      rate.description || "Delivery calculated by the Shopify GHS Shipping Calc app.";

    return {
      cents: Math.round(cents),
      serviceName,
      serviceCode: rate.service_code || "GHS_DELIVERY",
      description,
      eta: buildEta(rate),
      summary: `${serviceName}: $${(cents / 100).toFixed(2)}`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("GHS Shipping Calc timed out after 20 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
