import { supabaseAdmin } from "./supabase.server";

export type QuoteProductOption = {
  title: string;
  sku: string;
  vendor: string;
  imageUrl?: string;
};

export async function getProductOptionsFromShopify(
  admin: any,
): Promise<QuoteProductOption[]> {
  const response = await admin.graphql(`
    query AdminQuoteProducts {
      products(first: 100, sortKey: TITLE) {
        nodes {
          title
          vendor
          featuredImage {
            url
          }
          variants(first: 50) {
            nodes {
              sku
              title
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
    const vendor = product?.vendor || "";
    const productTitle = product?.title || "";
    const productImage = product?.featuredImage?.url || "";

    for (const variant of product?.variants?.nodes || []) {
      const sku = (variant?.sku || "").trim();
      if (!sku) continue;

      const variantTitle = (variant?.title || "").trim();
      const variantImage = variant?.image?.url || productImage || "";

      const title =
        variantTitle && variantTitle !== "Default Title"
          ? `${productTitle} - ${variantTitle}`
          : productTitle;

      options.push({
        title,
        sku,
        vendor,
        imageUrl: variantImage,
      });
    }
  }

  return options.sort((a, b) => a.title.localeCompare(b.title));
}

export async function syncProductOptionsToSupabase(
  products: QuoteProductOption[],
) {
  if (!products.length) return;

  const rows = products.map((product) => ({
    sku: product.sku,
    product_title: product.title,
    pickup_vendor: product.vendor,
    image_url: product.imageUrl || null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("product_source_map")
    .upsert(rows, { onConflict: "sku" });

  if (error) {
    console.error("[SYNC PRODUCT OPTIONS ERROR]", error);
  }
}

export async function getProductOptionsFromSupabase(): Promise<
  QuoteProductOption[]
> {
  const { data, error } = await supabaseAdmin
    .from("product_source_map")
    .select("sku, product_title, pickup_vendor, image_url")
    .order("product_title", { ascending: true });

  if (error || !data) {
    console.error("[GET PRODUCT OPTIONS FROM SUPABASE ERROR]", error);
    return [];
  }

  return data
    .filter((row: any) => row.sku)
    .map((row: any) => ({
      sku: row.sku,
      title: row.product_title || row.sku,
      vendor: row.pickup_vendor || "",
      imageUrl: row.image_url || "",
    }));
}