// app/routes/api.carrier-service.ts
import type { ActionFunctionArgs } from "react-router";
import { getQuote } from "../lib/quote-engine.server";

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.json();
  const rate = body?.rate ?? {};
  const destination = rate.destination ?? {};
  const items = Array.isArray(rate.items) ? rate.items : [];

  const quote = await getQuote({
    postalCode: destination.postal_code ?? "",
    country: destination.country ?? "US",
    province: destination.province ?? "",
    items: items.map((item: any) => ({
      sku: item.sku,
      quantity: item.quantity ?? 0,
      grams: item.grams ?? 0,
      price: item.price ?? 0,
      requiresShipping: item.requires_shipping !== false
    }))
  });

  return {
    rates: [
      {
        service_name: quote.serviceName,
        service_code: quote.serviceCode,
        total_price: String(quote.cents),
        description: quote.description,
        currency: rate.currency ?? "USD"
      }
    ]
  };
}
