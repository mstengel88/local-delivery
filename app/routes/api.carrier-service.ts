import type { ActionFunctionArgs } from "react-router";
import { json } from "react-router";
import { getQuote } from "../lib/quote-engine.server";

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.json();
  const rate = body?.rate ?? {};
  const destination = rate.destination ?? {};
  const items = Array.isArray(rate.items) ? rate.items : [];

  const shop =
    body?.shop ||
    request.headers.get("x-shopify-shop-domain") ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    "";

  const quote = await getQuote({
    shop,
    postalCode: destination.postal_code ?? "",
    country: destination.country ?? "US",
    province: destination.province ?? "",
    city: destination.city ?? "",
    address1: destination.address1 ?? "",
    address2: destination.address2 ?? "",
    items: items.map((item: any) => ({
      sku: item.sku,
      quantity: item.quantity ?? 0,
      grams: item.grams ?? 0,
      price: item.price ?? 0,
      requiresShipping: item.requires_shipping !== false,
      productVendor: item.vendor || item.product_vendor || "",
    })),
  });

  return json({
    rates: [
      {
        service_name: quote.serviceName,
        service_code: quote.serviceCode,
        total_price: String(quote.cents),
        description: quote.description,
        currency: rate.currency ?? "USD",
      },
    ],
  });
}
