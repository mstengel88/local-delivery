import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getQuote } from "../lib/quote-engine.server";
import { getPickupVendorMapForVariantIds } from "../lib/product-source.server";

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.json();
  const rate = body?.rate ?? {};
  const destination = rate.destination ?? {};
  const items = Array.isArray(rate.items) ? rate.items : [];

  console.log("[CARRIER RAW BODY]", JSON.stringify(body, null, 2));

  const shop =
    body?.shop ||
    request.headers.get("x-shopify-shop-domain") ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    "";

  const variantIds = items
    .map((item: any) => item.variant_id)
    .filter(Boolean);

  console.log("[CARRIER VARIANT IDS]", variantIds);

  const pickupVendorByVariant =
    variantIds.length > 0
      ? await getPickupVendorMapForVariantIds(shop, variantIds)
      : {};

  console.log("[PICKUP VENDOR BY VARIANT]", pickupVendorByVariant);

  const mappedItems = items.map((item: any) => ({
    sku: item.sku,
    quantity: item.quantity ?? 0,
    grams: item.grams ?? 0,
    price: item.price ?? 0,
    requiresShipping: item.requires_shipping !== false,
    pickupVendor: item.variant_id
      ? pickupVendorByVariant[item.variant_id] || ""
      : "",
  }));

  console.log("[MAPPED ITEMS]", JSON.stringify(mappedItems, null, 2));

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

  console.log("[QUOTE RESULT]", JSON.stringify(quote, null, 2));

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