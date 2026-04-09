import { authenticate } from "../shopify.server";
import { syncProductOptionsToSupabase } from "../lib/quote-products.server";

type WebhookProductVariant = {
  id?: number | string | null;
  admin_graphql_api_id?: string | null;
  sku?: string | null;
  title?: string | null;
  price?: number | string | null;
  image_id?: number | null;
  image?: {
    src?: string | null;
  } | null;
};

type WebhookProduct = {
  title?: string | null;
  vendor?: string | null;
  image?: {
    src?: string | null;
  } | null;
  variants?: WebhookProductVariant[] | null;
};

function toVariantGid(variant: WebhookProductVariant) {
  if (variant?.admin_graphql_api_id) return String(variant.admin_graphql_api_id);
  if (variant?.id === null || variant?.id === undefined) return "";
  return `gid://shopify/ProductVariant/${variant.id}`;
}

export async function action({ request }: { request: Request }) {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "PRODUCTS_UPDATE") {
    return new Response();
  }

  const product = payload as WebhookProduct;

  const options = [];

  for (const variant of product.variants || []) {
    if (!variant.sku) continue;

    const variantTitle = String(variant.title || "").trim();
    const title =
      variantTitle && variantTitle !== "Default Title"
        ? `${product.title} - ${variantTitle}`
        : product.title;

    options.push({
      sku: variant.sku,
      variantId: toVariantGid(variant),
      title,
      vendor: product.vendor,
      imageUrl: variant.image?.src || product.image?.src || "",
      price:
        variant.price === null || variant.price === undefined
          ? undefined
          : Number(variant.price),
    });
  }

  await syncProductOptionsToSupabase(options);

  console.log("[WEBHOOK SYNC]", shop, product.title);

  return new Response();
}
