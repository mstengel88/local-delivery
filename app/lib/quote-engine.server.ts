// app/lib/quote-engine.server.ts
export type QuoteInput = {
  postalCode: string;
  country: string;
  province?: string;
  items: Array<{
    sku?: string;
    quantity: number;
    grams?: number;
    price?: number;
    requiresShipping?: boolean;
  }>;
};

export type QuoteResult = {
  serviceName: string;
  serviceCode: string;
  cents: number;
  description: string;
  eta: string;
  summary: string;
};

export async function getQuote(input: QuoteInput): Promise<QuoteResult> {
  const shippableItems = input.items.filter((item) => item.requiresShipping !== false);

  const totalWeight = shippableItems.reduce(
    (sum, item) => sum + (item.grams ?? 0) * item.quantity,
    0
  );

  const remoteZone = input.postalCode.startsWith("9");
  const base = Math.max(999, Math.ceil(totalWeight / 500) * 175);
  const surcharge = remoteZone ? 300 : 0;
  const cents = base + surcharge;

  return {
    serviceName: "Custom Delivery",
    serviceCode: "CUSTOM_DELIVERY",
    cents,
    description: remoteZone ? "Remote-area pricing applied" : "Standard delivery pricing",
    eta: remoteZone ? "4–6 business days" : "2–4 business days",
    summary: `Shipping calculated from your address: $${(cents / 100).toFixed(2)}`
  };
}
