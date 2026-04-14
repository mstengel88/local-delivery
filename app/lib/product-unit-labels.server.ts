const UNIT_LABEL_NAMESPACE = "app";
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
            metafield(namespace: "app", key: "price_unit_label") {
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
    unitLabel: product.metafield?.value ?? "",
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
