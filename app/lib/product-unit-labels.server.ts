import shopify from "../shopify.server";

const UNIT_LABEL_NAMESPACE = "green_hills";
const UNIT_LABEL_KEY = "price_unit_label";
const UNIT_LABEL_TYPE = "single_line_text_field";

export type ProductUnitLabelRecord = {
  id: string;
  title: string;
  handle: string;
  status: string;
  onlineStoreUrl: string | null;
  imageUrl: string | null;
  unitLabel: string;
};

type AdminGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export const productUnitLabelDefinition = {
  namespace: UNIT_LABEL_NAMESPACE,
  key: UNIT_LABEL_KEY,
  type: UNIT_LABEL_TYPE,
};

export async function ensureProductUnitLabelDefinition(admin: AdminGraphqlClient) {
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

  if (setInputs.length) {
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
      { variables: { metafields: setInputs } },
    );

    const setJson = await setResponse.json();
    userErrors.push(...(setJson?.data?.metafieldsSet?.userErrors ?? []));
  }

  if (deleteInputs.length) {
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
      { variables: { metafields: deleteInputs } },
    );

    const deleteJson = await deleteResponse.json();
    userErrors.push(...(deleteJson?.data?.metafieldsDelete?.userErrors ?? []));
  }

  return { userErrors };
}

export async function getProductUnitLabelsByHandles(shop: string, handles: string[]) {
  if (!shop || !handles.length) return {};

  const uniqueHandles = Array.from(new Set(handles.map((handle) => handle.trim()).filter(Boolean)));
  if (!uniqueHandles.length) return {};

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
  const nodes = json?.data?.products?.nodes ?? [];

  return nodes.reduce((acc: Record<string, string>, product: any) => {
    if (product?.handle && product?.metafield?.value) {
      acc[product.handle] = product.metafield.value;
    }
    return acc;
  }, {});
}
