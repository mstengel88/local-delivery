import { shopify } from "../shopify.server";

type VariantPickupVendorMap = Record<string, string>;

function escapeGraphQLString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function getPickupVendorMapForSkus(
  shop: string,
  skus: string[],
): Promise<VariantPickupVendorMap> {
  const uniqueSkus = Array.from(
    new Set(skus.map((sku) => (sku || "").trim()).filter(Boolean)),
  );

  if (!shop || uniqueSkus.length === 0) {
    return {};
  }

  const { admin } = await shopify.unauthenticated.admin(shop);

  const result: VariantPickupVendorMap = {};

  for (const sku of uniqueSkus) {
    const query = `
      query VariantBySku {
        productVariants(first: 1, query: "sku:${escapeGraphQLString(sku)}") {
          nodes {
            sku
            product {
              metafield(namespace: "shipping", key: "pickup_vendor") {
                value
              }
            }
          }
        }
      }
    `;

    const response = await admin.graphql(query);
    const json = await response.json();

    const node = json?.data?.productVariants?.nodes?.[0];
    const pickupVendor = node?.product?.metafield?.value || "";

    if (node?.sku) {
      result[node.sku] = pickupVendor;
    }
  }

  return result;
}