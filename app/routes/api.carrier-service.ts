import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getQuote } from "../lib/quote-engine.server";

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  let body: any;

  try {
    body = await request.json();
  } catch (error) {
    console.error("[CARRIER SERVICE FAIL CLOSED] Invalid request body", error);
    return data({ rates: [] });
  }

  const rate = body?.rate ?? {};
  const destination = rate.destination ?? {};
  const items = Array.isArray(rate.items) ? rate.items : [];

  const shop =
    url.searchParams.get("shop") ||
    body?.shop ||
    request.headers.get("x-shopify-shop-domain") ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    "";

  if (!shop) {
    console.error("[CARRIER SERVICE FAIL CLOSED] Missing shop parameter");
    return data({ rates: [] });
  }

  const mappedItems = items.map((item: any) => ({
    sku: item.sku,
    quantity: item.quantity ?? 0,
    grams: item.grams ?? 0,
    price: item.price ?? 0,
    requiresShipping: item.requires_shipping !== false,
    pickupVendor: item.vendor || item.product_vendor || "",
  }));

  console.log("[CARRIER SHOP]", shop);
  console.log("[MAPPED ITEMS]", JSON.stringify(mappedItems, null, 2));

  let quote;

  try {
    quote = await getQuote({
      shop,
      postalCode: destination.postal_code ?? "",
      country: destination.country ?? "US",
      province: destination.province ?? "",
      city: destination.city ?? "",
      address1: destination.address1 ?? "",
      address2: destination.address2 ?? "",
      items: mappedItems,
    });
  } catch (error) {
    console.error("[CARRIER SERVICE FAIL CLOSED] Quote calculation failed", error);
    return data({ rates: [] });
  }

  console.log("[QUOTE RESULT]", JSON.stringify(quote, null, 2));

  if (
    quote.serviceName === "Delivery Unavailable" ||
    quote.eta === "Unavailable" ||
    quote.summary === "Unable to calculate delivery route"
  ) {
    console.error("[CARRIER SERVICE FAIL CLOSED] Delivery quote unavailable", {
      serviceName: quote.serviceName,
      description: quote.description,
      summary: quote.summary,
    });
    return data({ rates: [] });
  }

  if (quote.outsideDeliveryArea) {
    return data({
      rates: [
        {
          service_name: "Call for delivery quote",
          service_code: "CALL_FOR_QUOTE",
          total_price: "1",
          description: "Outside delivery area — please call for custom quote",
          currency: rate.currency ?? "USD",
        },
      ],
    });
  }

  return data({
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
