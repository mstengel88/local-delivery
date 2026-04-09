import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../lib/supabase.server";

export async function action({ request }: any) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 50) {
        edges {
          node {
            title
            vendor
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            variants(first: 10) {
              edges {
                node {
                  sku
                }
              }
            }
          }
        }
      }
    }
  `);

  const json = await response.json();

  const products = json.data.products.edges;

  for (const p of products) {
    const title = p.node.title;
    const vendor = p.node.vendor;
    const imageUrl =
      p.node.images.edges[0]?.node.url || null;

    for (const v of p.node.variants.edges) {
      const sku = v.node.sku;
      if (!sku) continue;

      await supabase.from("product_source_map").upsert({
        sku,
        product_title: title,
        pickup_vendor: vendor,
        image_url: imageUrl,
        updated_at: new Date().toISOString(),
      });
    }
  }

  return data({ ok: true, count: products.length });
}