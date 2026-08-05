import shopify from "../shopify.server";
import { supabaseAdmin } from "./supabase.server";

const UNIT_LABEL_NAMESPACE = "green_hills";
const UNIT_LABEL_KEY = "price_unit_label";
const UNIT_LABEL_TYPE = "single_line_text_field";
const SHOP_LABEL_COLOR_KEY = "price_unit_label_color";
const SHOP_LABEL_COLOR_TYPE = "single_line_text_field";

export type ProductUnitLabelRecord = {
  id: string;
  title: string;
  handle: string;
  status: string;
  onlineStoreUrl: string | null;
  imageUrl: string | null;
  unitLabel: string;
};

export const DEFAULT_LABEL_COLOR = "#d1d5db";

type AdminGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type HandleLookupProductNode = {
  handle?: string | null;
  metafield?: {
    value?: string | null;
  } | null;
  legacyUnitLabel?: {
    value?: string | null;
  } | null;
  variants?: {
    nodes?: Array<{
      sku?: string | null;
    }> | null;
  } | null;
};

type SkuLookupRow = {
  sku: string | null;
  unit_label?: string | null;
  price_unit_label?: string | null;
};

type ProductVariantsByProductIdNode = {
  id?: string | null;
  title?: string | null;
  vendor?: string | null;
  featuredImage?: {
    url?: string | null;
  } | null;
  variants?: {
    nodes?: Array<{
      id?: string | null;
      sku?: string | null;
      title?: string | null;
      image?: {
        url?: string | null;
      } | null;
    }> | null;
  } | null;
};

export const productUnitLabelDefinition = {
  namespace: UNIT_LABEL_NAMESPACE,
  key: UNIT_LABEL_KEY,
  type: UNIT_LABEL_TYPE,
};

export async function ensureProductUnitLabelDefinition(admin: AdminGraphqlClient) {
  try {
    const lookupResponse = await admin.graphql(
      `#graphql
        query ProductUnitLabelDefinition {
          metafieldDefinitions(first: 20, ownerType: PRODUCT, namespace: "green_hills") {
            nodes {
              id
              key
              access {
                storefront
              }
            }
          }
        }
      `,
    );

    const lookupJson = await lookupResponse.json();
    const definitions = lookupJson?.data?.metafieldDefinitions?.nodes ?? [];
    const existing = definitions.find((definition: any) => definition.key === UNIT_LABEL_KEY);

    if (!existing) {
      const createResponse = await admin.graphql(
        `#graphql
          mutation CreateProductUnitLabelDefinition {
            metafieldDefinitionCreate(
              definition: {
                name: "Price unit label"
                namespace: "green_hills"
                key: "price_unit_label"
                description: "Short label appended next to storefront prices, such as per yard or per ton."
                type: "single_line_text_field"
                ownerType: PRODUCT
                access: {
                  storefront: PUBLIC_READ
                }
              }
            ) {
              createdDefinition {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
      );

      const createJson = await createResponse.json();
      return {
        userErrors: createJson?.data?.metafieldDefinitionCreate?.userErrors ?? [],
      };
    }

    if (existing.access?.storefront !== "PUBLIC_READ") {
      const updateResponse = await admin.graphql(
        `#graphql
          mutation UpdateProductUnitLabelDefinition($id: ID!) {
            metafieldDefinitionUpdate(
              id: $id
              definition: {
                access: {
                  storefront: PUBLIC_READ
                }
              }
            ) {
              updatedDefinition {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        { variables: { id: existing.id } },
      );

      const updateJson = await updateResponse.json();
      return {
        userErrors: updateJson?.data?.metafieldDefinitionUpdate?.userErrors ?? [],
      };
    }
  } catch (error) {
    console.error("[UNIT LABEL DEFINITION ERROR]", error);
  }

  return { userErrors: [] };
}

export async function ensureShopUnitLabelColorDefinition(admin: AdminGraphqlClient) {
  try {
    const lookupResponse = await admin.graphql(
      `#graphql
        query ShopUnitLabelColorDefinition {
          metafieldDefinitions(first: 20, ownerType: SHOP, namespace: "green_hills") {
            nodes {
              id
              key
              access {
                storefront
              }
            }
          }
        }
      `,
    );

    const lookupJson = await lookupResponse.json();
    const definitions = lookupJson?.data?.metafieldDefinitions?.nodes ?? [];
    const existing = definitions.find((definition: any) => definition.key === SHOP_LABEL_COLOR_KEY);

    if (!existing) {
      const createResponse = await admin.graphql(
        `#graphql
          mutation CreateShopUnitLabelColorDefinition {
            metafieldDefinitionCreate(
              definition: {
                name: "Price unit label color"
                namespace: "green_hills"
                key: "price_unit_label_color"
                description: "Color used for storefront unit labels."
                type: "single_line_text_field"
                ownerType: SHOP
                access: {
                  storefront: PUBLIC_READ
                }
              }
            ) {
              createdDefinition {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
      );

      const createJson = await createResponse.json();
      return {
        userErrors: createJson?.data?.metafieldDefinitionCreate?.userErrors ?? [],
      };
    }

    if (existing.access?.storefront !== "PUBLIC_READ") {
      const updateResponse = await admin.graphql(
        `#graphql
          mutation UpdateShopUnitLabelColorDefinition($id: ID!) {
            metafieldDefinitionUpdate(
              id: $id
              definition: {
                access: {
                  storefront: PUBLIC_READ
                }
              }
            ) {
              updatedDefinition {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        { variables: { id: existing.id } },
      );

      const updateJson = await updateResponse.json();
      return {
        userErrors: updateJson?.data?.metafieldDefinitionUpdate?.userErrors ?? [],
      };
    }
  } catch (error) {
    console.error("[SHOP LABEL COLOR DEFINITION ERROR]", error);
  }

  return { userErrors: [] };
}

export async function listProductUnitLabels(
  admin: AdminGraphqlClient,
  first = 100,
): Promise<ProductUnitLabelRecord[]> {
  const response = await admin.graphql(
    `#graphql
      query ProductUnitLabels($first: Int!) {
        products(first: $first, sortKey: TITLE) {
          nodes {
            id
            title
            handle
            status
            onlineStorePreviewUrl
            featuredImage {
              url
            }
            metafield(namespace: "green_hills", key: "price_unit_label") {
              value
            }
            legacyUnitLabel: metafield(namespace: "$app", key: "price_unit_label") {
              value
            }
          }
        }
      }
    `,
    { variables: { first } },
  );

  const json = await response.json();
  const nodes = json?.data?.products?.nodes ?? [];

  return nodes.map((product: any) => ({
    id: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    onlineStoreUrl: product.onlineStorePreviewUrl ?? null,
    imageUrl: product.featuredImage?.url ?? null,
    unitLabel: product.metafield?.value ?? product.legacyUnitLabel?.value ?? "",
  }));
}

export async function getShopUnitLabelColor(admin: AdminGraphqlClient): Promise<string> {
  const response = await admin.graphql(
    `#graphql
      query ShopUnitLabelColor {
        shop {
          metafield(namespace: "green_hills", key: "price_unit_label_color") {
            value
          }
        }
      }
    `,
  );

  const json = await response.json();
  return json?.data?.shop?.metafield?.value || DEFAULT_LABEL_COLOR;
}

export async function saveShopUnitLabelColor(admin: AdminGraphqlClient, color: string) {
  const shopResponse = await admin.graphql(
    `#graphql
      query ShopUnitLabelColorOwner {
        shop {
          id
        }
      }
    `,
  );

  const shopJson = await shopResponse.json();
  const shopId = shopJson?.data?.shop?.id;

  if (!shopId) {
    return { userErrors: [{ message: "Could not determine shop id for label color save." }] };
  }

  const response = await admin.graphql(
    `#graphql
      mutation SaveShopUnitLabelColor($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: UNIT_LABEL_NAMESPACE,
            key: SHOP_LABEL_COLOR_KEY,
            type: SHOP_LABEL_COLOR_TYPE,
            value: color,
          },
        ],
      },
    },
  );

  const json = await response.json();
  return {
    userErrors: [
      ...(json?.errors ?? []).map((error: any) => ({ message: error.message })),
      ...(json?.data?.metafieldsSet?.userErrors ?? []),
    ],
  };
}

export async function saveProductUnitLabels(
  admin: AdminGraphqlClient,
  updates: Array<{ productId: string; unitLabel: string }>,
) {
  const setInputs = updates
    .filter((update) => update.unitLabel.trim())
    .map((update) => ({
      ownerId: update.productId,
      namespace: UNIT_LABEL_NAMESPACE,
      key: UNIT_LABEL_KEY,
      type: UNIT_LABEL_TYPE,
      value: update.unitLabel.trim(),
    }));

  const deleteInputs = updates
    .filter((update) => !update.unitLabel.trim())
    .map((update) => ({
      ownerId: update.productId,
      namespace: UNIT_LABEL_NAMESPACE,
      key: UNIT_LABEL_KEY,
    }));

  const userErrors: Array<{ field?: string[]; message: string }> = [];
  const chunkSize = 25;

  for (let index = 0; index < setInputs.length; index += chunkSize) {
    const chunk = setInputs.slice(index, index + chunkSize);
    const setResponse = await admin.graphql(
      `#graphql
        mutation SaveProductUnitLabels($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors {
              field
              message
            }
          }
        }
      `,
      { variables: { metafields: chunk } },
    );

    const setJson = await setResponse.json();
    userErrors.push(...(setJson?.errors ?? []).map((error: any) => ({ message: error.message })));
    userErrors.push(...(setJson?.data?.metafieldsSet?.userErrors ?? []));
  }

  for (let index = 0; index < deleteInputs.length; index += chunkSize) {
    const chunk = deleteInputs.slice(index, index + chunkSize);
    const deleteResponse = await admin.graphql(
      `#graphql
        mutation DeleteProductUnitLabels($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            userErrors {
              field
              message
            }
          }
        }
      `,
      { variables: { metafields: chunk } },
    );

    const deleteJson = await deleteResponse.json();
    userErrors.push(...(deleteJson?.errors ?? []).map((error: any) => ({ message: error.message })));
    userErrors.push(...(deleteJson?.data?.metafieldsDelete?.userErrors ?? []));
  }

  if (!userErrors.length) {
    try {
      await syncProductUnitLabelsToSupabase(admin, updates);
    } catch (error: any) {
      console.error("[SYNC UNIT LABELS TO SUPABASE ERROR]", error);
      userErrors.push({
        message: error?.message || "Saved Shopify labels, but failed to sync Supabase labels.",
      });
    }
  }

  return { userErrors };
}

async function syncProductUnitLabelsToSupabase(
  admin: AdminGraphqlClient,
  updates: Array<{ productId: string; unitLabel: string }>,
) {
  const uniqueProductIds = Array.from(
    new Set(updates.map((update) => update.productId.trim()).filter(Boolean)),
  );

  if (!uniqueProductIds.length) return;

  const updatesByProductId = new Map(
    updates.map((update) => [update.productId.trim(), update.unitLabel.trim()]),
  );

  const collectedSkus = new Set<string>();
  const productNodes: ProductVariantsByProductIdNode[] = [];

  for (let index = 0; index < uniqueProductIds.length; index += 50) {
    const chunk = uniqueProductIds.slice(index, index + 50);
    const response = await admin.graphql(
      `#graphql
        query ProductVariantsByProductIds($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              vendor
              featuredImage {
                url
              }
              variants(first: 100) {
                nodes {
                  id
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
      `,
      { variables: { ids: chunk } },
    );

    const json = await response.json();
    const nodes = (json?.data?.nodes ?? []) as ProductVariantsByProductIdNode[];
    productNodes.push(...nodes);

    for (const product of nodes) {
      for (const variant of product?.variants?.nodes || []) {
        const sku = (variant?.sku || "").trim();
        if (sku) collectedSkus.add(sku);
      }
    }
  }

  const { data: existingRows, error: existingRowsError } = await supabaseAdmin
    .from("product_source_map")
    .select("sku, variant_id, product_title, pickup_vendor, image_url, unit_label, price_unit_label")
    .in("sku", Array.from(collectedSkus));

  if (existingRowsError) {
    throw existingRowsError;
  }

  const existingBySku = new Map<string, any>(
    ((existingRows as any[] | null) || []).map((row) => [String(row.sku || "").trim(), row]),
  );

  const rows: Array<{
    sku: string;
    variant_id: string | null;
    product_title: string;
    pickup_vendor: string;
    image_url: string | null;
    unit_label: string | null;
    price_unit_label: string | null;
    updated_at: string;
  }> = [];

  for (const product of productNodes) {
      const productId = (product?.id || "").trim();
      const unitLabel = updatesByProductId.get(productId);
      if (unitLabel === undefined) continue;
      const productTitle = (product?.title || "").trim();
      const vendor = (product?.vendor || "").trim();
      const productImage = product?.featuredImage?.url || "";

      for (const variant of product?.variants?.nodes || []) {
        const sku = (variant?.sku || "").trim();
        if (!sku) continue;
        const existing = existingBySku.get(sku);
        const variantId = (variant?.id || "").trim();
        const variantTitle = (variant?.title || "").trim();
        const title =
          variantTitle && variantTitle !== "Default Title"
            ? `${productTitle} - ${variantTitle}`
            : productTitle || existing?.product_title || sku;
        const imageUrl = variant?.image?.url || productImage || existing?.image_url || null;

        rows.push({
          sku,
          variant_id: variantId || existing?.variant_id || null,
          product_title: title || sku,
          pickup_vendor: vendor || existing?.pickup_vendor || "",
          image_url: imageUrl,
          unit_label: unitLabel || null,
          price_unit_label: unitLabel || null,
          updated_at: new Date().toISOString(),
        });
      }
  }

  if (!rows.length) return;

  const { error } = await supabaseAdmin
    .from("product_source_map")
    .upsert(rows, { onConflict: "sku" });

  if (error) {
    throw error;
  }
}

export async function getProductUnitLabelsByHandlesAndSkus(
  shop: string,
  handles: string[],
  skus: string[],
) {
  if ((!shop || !handles.length) && !skus.length) {
    return { labelsByHandle: {}, labelsBySku: {}, color: DEFAULT_LABEL_COLOR };
  }

  const uniqueHandles = Array.from(new Set(handles.map((handle) => handle.trim()).filter(Boolean)));
  const uniqueSkus = Array.from(new Set(skus.map((sku) => sku.trim()).filter(Boolean)));

  const labelsBySku: Record<string, string> = {};

  if (uniqueSkus.length) {
    const { data, error } = await supabaseAdmin
      .from("product_source_map")
      .select("sku, unit_label, price_unit_label")
      .in("sku", uniqueSkus);

    if (error) {
      console.error("[SUPABASE UNIT LABEL LOOKUP ERROR]", error);
    } else {
      for (const row of (data || []) as SkuLookupRow[]) {
        const sku = String(row.sku || "").trim();
        const label = String(row.unit_label || row.price_unit_label || "").trim();
        if (sku && label) labelsBySku[sku] = label;
      }
    }
  }

  let labelsByHandle: Record<string, string> = {};
  let color = DEFAULT_LABEL_COLOR;

  if (shop && uniqueHandles.length) {
    try {
      const client = await shopify.unauthenticated.admin(shop);
      const searchQuery = uniqueHandles.map((handle) => `handle:${handle}`).join(" OR ");

      const response = await client.admin.graphql(
        `#graphql
          query ProductUnitLabelsByHandle($first: Int!, $query: String!) {
            products(first: $first, query: $query) {
              nodes {
                handle
                metafield(namespace: "green_hills", key: "price_unit_label") {
                  value
                }
                legacyUnitLabel: metafield(namespace: "$app", key: "price_unit_label") {
                  value
                }
                variants(first: 50) {
                  nodes {
                    sku
                  }
                }
              }
            }
          }
        `,
        {
          variables: {
            first: uniqueHandles.length,
            query: searchQuery,
          },
        },
      );

      const json = await response.json();
      if (json?.errors?.length) {
        throw new Error(
          `Shopify product unit label lookup failed: ${json.errors
            .map((error: { message?: string }) => error.message || "Unknown GraphQL error")
            .join("; ")}`,
        );
      }
      const nodes = (json?.data?.products?.nodes ?? []) as HandleLookupProductNode[];

      labelsByHandle = nodes.reduce((acc: Record<string, string>, product) => {
        const handle = (product?.handle || "").trim();
        if (!handle) return acc;

        const shopifyLabel = String(
          product?.metafield?.value || product?.legacyUnitLabel?.value || "",
        ).trim();

        if (shopifyLabel) {
          acc[handle] = shopifyLabel;
          return acc;
        }

        for (const variant of product?.variants?.nodes || []) {
          const sku = (variant?.sku || "").trim();
          const supabaseLabel = sku ? labelsBySku[sku] : "";
          if (supabaseLabel) {
            acc[handle] = supabaseLabel;
            break;
          }
        }

        return acc;
      }, {});

      const shopResponse = await client.admin.graphql(
        `#graphql
          query ShopUnitLabelColorByShop {
            shop {
              metafield(namespace: "green_hills", key: "price_unit_label_color") {
                value
              }
            }
          }
        `,
      );

      const shopJson = await shopResponse.json();
      if (shopJson?.errors?.length) {
        throw new Error(
          `Shopify unit label color lookup failed: ${shopJson.errors
            .map((error: { message?: string }) => error.message || "Unknown GraphQL error")
            .join("; ")}`,
        );
      }
      color = shopJson?.data?.shop?.metafield?.value || DEFAULT_LABEL_COLOR;
    } catch (error) {
      console.error("[UNIT LABEL SHOP LOOKUP ERROR]", error);
    }
  }

  return { labelsByHandle, labelsBySku, color };
}
