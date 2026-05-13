import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getQuote } from "../lib/quote-engine.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return data({ ok: false, message: "Method not allowed" }, { status: 405, headers: corsHeaders });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const body = await request.json();

  const shippingAddress = body?.shippingAddress ?? {};
  const lines = Array.isArray(body?.lines) ? body.lines : [];

  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") ||
    body?.shop ||
    request.headers.get("x-shopify-shop-domain") ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    "";

  if (!shop) {
    throw new Error("Missing shop parameter");
  }

  const quote = await getQuote({
    shop,
    postalCode: shippingAddress.zip ?? "",
    country: shippingAddress.countryCode ?? "US",
    province: shippingAddress.provinceCode ?? "",
    city: shippingAddress.city ?? "",
    address1: shippingAddress.address1 ?? "",
    address2: shippingAddress.address2 ?? "",
    items: lines.map((line: any) => ({
      sku: line.sku,
      quantity: line.quantity ?? 0,
      grams: line.grams ?? 0,
      price: line.price ?? 0,
      requiresShipping: true,
      productVendor: line.vendor || line.product_vendor || "",
    })),
  });

  return data(
    {
      summary: quote.summary,
      eta: quote.eta,
      description: quote.description,
      cents: quote.cents,
      serviceName: quote.serviceName,
      outsideDeliveryArea: quote.outsideDeliveryArea ?? false,
      outsideDeliveryMiles: quote.outsideDeliveryMiles ?? 0,
      outsideDeliveryRadius: quote.outsideDeliveryRadius ?? 50,
      outsideDeliveryPhone: quote.outsideDeliveryPhone ?? "(262) 345-4001",
    },
    { headers: corsHeaders },
  );
}
