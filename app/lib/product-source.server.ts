import shopify from "../shopify.server";

type VariantPickupVendorMap = Record<string, string>;

export async function getPickupVendorMapForVariantIds(
  shop: string,
  variantIds: string[],
): Promise<VariantPickupVendorMap> {
  if (!shop || variantIds.length === 0) return {};

  const result: VariantPickupVendorMap = {};

  try {
    const client = await shopify.unauthenticated.admin(shop);

    for (const id of variantIds) {
      const gid = `gid://shopify/ProductVariant/${id}`;

      const query = `
        query VariantLookup {
          node(id: "${gid}") {
            ... on ProductVariant {
              id
              product {
                metafield(namespace: "shipping", key: "pickup_vendor") {
                  value
                }
              }
            }
          }
        }
      `;

      const res = await client.admin.graphql(query);
      const json = await res.json();

      const node = json?.data?.node;
      const pickupVendor = node?.product?.metafield?.value || "";

      result[id] = pickupVendor;
    }
  } catch (err) {
    console.error("[VARIANT LOOKUP ERROR]", err);
  }

  return result;
}