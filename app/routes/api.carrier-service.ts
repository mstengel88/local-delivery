import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getQuote } from "../lib/quote-engine.server";
import { getPickupVendorMapForSkus } from "../lib/product-source.server";

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

  const skus = items
    .map((item: any) => item.sku)
    .filter((sku: string | undefined) => Boolean(sku));

  const pickupVendorBySku = await getPickupVendorMapForSkus(shop, skus);

  const mappedItems = items.map((item: any) => ({
    sku: item.sku,
    quantity: item.quantity ?? 0,
    grams: item.grams ?? 0,
    price: item.price ?? 0,
    requiresShipping: item.requires_shipping !== false,
    pickupVendor: item.sku ? pickupVendorBySku[item.sku] || "" : "",
  }));

  const quote = await getQuote({
    shop,
    postalCode: destination.postal_code ?? "",
    country: destination.country ?? "US",
    province: destination.province ?? "",
    city: destination.city ?? "",
    address1: destination.address1 ?? "",
    address2: destination.address2 ?? "",
    items: mappedItems,
  });

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