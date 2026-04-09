import { supabaseAdmin } from "./supabase.server";

export type QuoteProductOption = {
  sku: string;
  variantId?: string;
  title: string;
  vendor: string;
  imageUrl?: string;
  price?: number;
};

export async function getProductOptionsFromSupabase(): Promise<
  QuoteProductOption[]
> {
  const { data, error } = await supabaseAdmin
    .from("product_source_map")
    .select("sku, variant_id, product_title, pickup_vendor, image_url, price")
    .order("product_title", { ascending: true });

  if (error) {
    console.error("[GET PRODUCT OPTIONS FROM SUPABASE ERROR]", error);
    return [];
  }

  return (data || [])
    .filter((row: any) => row.sku)
    .map((row: any) => ({
      sku: row.sku,
      variantId: row.variant_id || "",
      title: row.product_title || row.sku,
      vendor: row.pickup_vendor || "",
      imageUrl: row.image_url || "",
      price:
        row.price === null || row.price === undefined
          ? undefined
          : Number(row.price),
    }));
}

export async function syncProductOptionsToSupabase(
  products: QuoteProductOption[],
) {
  if (!products.length) return;

  const rows = products.map((product) => ({
    sku: product.sku,
    variant_id: product.variantId || null,
    product_title: product.title,
    pickup_vendor: product.vendor,
    image_url: product.imageUrl || null,
    price:
      product.price === null || product.price === undefined
        ? null
        : Number(product.price),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("product_source_map")
    .upsert(rows, { onConflict: "sku" });

  if (error) {
    console.error("[SYNC PRODUCT OPTIONS ERROR]", error);
    throw error;
  }
}

export async function fetchProductOptionsFromShopify(admin: any) {
  const response = await admin.graphql(`
    query SyncProductsForQuotes {
      products(first: 100, sortKey: TITLE) {
        nodes {
          title
          vendor
          featuredImage {
            url
          }
          variants(first: 50) {
            nodes {
              id
              sku
              title
              price
              image {
                url
              }
            }
          }
        }
      }
    }
  `);

  const json = await response.json();
  const products = json?.data?.products?.nodes || [];
  const options: QuoteProductOption[] = [];

  for (const product of products) {
    const productTitle = product?.title || "";
    const vendor = product?.vendor || "";
    const productImage = product?.featuredImage?.url || "";

    for (const variant of product?.variants?.nodes || []) {
      const sku = (variant?.sku || "").trim();
      if (!sku) continue;

      const variantTitle = (variant?.title || "").trim();
      const title =
        variantTitle && variantTitle !== "Default Title"
          ? `${productTitle} - ${variantTitle}`
          : productTitle;

      options.push({
        sku,
        variantId: variant?.id || "",
        title,
        vendor,
        imageUrl: variant?.image?.url || productImage || "",
        price:
          variant?.price === null || variant?.price === undefined
            ? undefined
            : Number(variant.price),
      });
    }
  }

  return options.sort((a, b) => a.title.localeCompare(b.title));
}