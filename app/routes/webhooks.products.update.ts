import { authenticate } from "../shopify.server";
import { syncProductOptionsToSupabase } from "../lib/quote-products.server";

export async function action({ request }: any) {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "PRODUCTS_UPDATE") {
    return new Response();
  }

  const product = payload;

  const options: any[] = [];

  for (const variant of product.variants || []) {
    if (!variant.sku) continue;

    options.push({
      sku: variant.sku,
      title: product.title,
      vendor: product.vendor,
      imageUrl: product.image?.src || "",
      price: Number(variant.price || 0),
    });
  }

  await syncProductOptionsToSupabase(options);

  console.log("[WEBHOOK SYNC]", product.title);

  return new Response();
}