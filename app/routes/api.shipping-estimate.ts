// app/routes/api.shipping-estimate.ts
import type { ActionFunctionArgs } from "react-router";
import { getQuote } from "../lib/quote-engine.server";

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.json();

  const shippingAddress = body?.shippingAddress ?? {};
  const lines = Array.isArray(body?.lines) ? body.lines : [];

  const quote = await getQuote({
    postalCode: shippingAddress.zip ?? "",
    country: shippingAddress.countryCode ?? "US",
    province: shippingAddress.provinceCode ?? "",
    items: lines.map((line: any) => ({
      sku: line.sku,
      quantity: line.quantity ?? 0,
      grams: line.grams ?? 0,
      price: line.price ?? 0,
      requiresShipping: true
    }))
  });

  return {
    summary: quote.summary,
    eta: quote.eta,
    description: quote.description,
    cents: quote.cents,
    serviceName: quote.serviceName
  };
}
