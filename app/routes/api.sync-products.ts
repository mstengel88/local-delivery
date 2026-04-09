import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { supabaseAdmin } from "../lib/supabase.server";

export async function action({ request }: any) {
  const { admin } = await authenticate.admin(request);

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

  let variantCount = 0;

  for (const product of products) {
    const productTitle = product?.title || "";
    const vendor = product?.vendor || "";
    const productImage = product?.featuredImage?.url || "";

    for (const variant of product?.variants?.nodes || []) {
      const sku = (variant?.sku || "").trim();
      if (!sku) continue;

      const variantTitle = (variant?.title || "").trim();
      const imageUrl = variant?.image?.url || productImage || "";

      const title =
        variantTitle && variantTitle !== "Default Title"
          ? `${productTitle} - ${variantTitle}`
          : productTitle;

      const { error } = await supabaseAdmin.from("product_source_map").upsert(
        {
          sku,
          product_title: title,
          pickup_vendor: vendor,
          image_url: imageUrl || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "sku" },
      );

      if (error) {
        console.error("[SYNC PRODUCTS UPSERT ERROR]", error);
      } else {
        variantCount += 1;
      }
    }
  }

  return data({
    ok: true,
    productCount: products.length,
    variantCount,
  });
}