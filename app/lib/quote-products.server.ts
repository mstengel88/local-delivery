import { supabaseAdmin } from "./supabase.server";

export type QuoteProductOption = {
  sku: string;
  variantId?: string;
  title: string;
  vendor: string;
  imageUrl?: string;
  price?: number;
  contractorTier1Price?: number;
  contractorTier2Price?: number;
};

type ProductSourceMapRow = {
  sku: string;
  variant_id: string | null;
  product_title: string | null;
  pickup_vendor: string | null;
  image_url: string | null;
  price: number | string | null;
};

type ShopifyProductVariantNode = {
  id?: string | null;
  sku?: string | null;
  title?: string | null;
  price?: number | string | null;
  image?: {
    url?: string | null;
  } | null;
};

type ShopifyProductNode = {
  title?: string | null;
  vendor?: string | null;
  featuredImage?: {
    url?: string | null;
  } | null;
  variants?: {
    nodes?: ShopifyProductVariantNode[] | null;
  } | null;
};

type ShopifyAdminClient = {
  graphql: (query: string) => Promise<Response>;
};

type ProductSyncStatus = {
  updated_at?: string | null;
};

function toNumberOrUndefined(value: unknown) {
  return value === null || value === undefined || value === ""
    ? undefined
    : Number(value);
}

export async function getProductOptionsFromSupabase(): Promise<
  QuoteProductOption[]
> {
  const { data, error } = await supabaseAdmin
    .from("product_source_map")
    .select("*")
    .order("product_title", { ascending: true });

  if (error) {
    console.error("[GET PRODUCT OPTIONS FROM SUPABASE ERROR]", error);
    return [];
  }

  return ((data as ProductSourceMapRow[] | null) || [])
    .filter((row) => row.sku)
    .map((row) => ({
      sku: row.sku,
      variantId: row.variant_id || "",
      title: row.product_title || row.sku,
      vendor: row.pickup_vendor || "",
      imageUrl: row.image_url || "",
      price: toNumberOrUndefined(row.price),
      contractorTier1Price: toNumberOrUndefined(
        row.contractor_tier_1_price ?? row.tier_1_price,
      ),
      contractorTier2Price: toNumberOrUndefined(
        row.contractor_tier_2_price ?? row.tier_2_price,
      ),
    }));
}

export async function getLatestProductSyncTimestamp() {
  const { data, error } = await supabaseAdmin
    .from("product_source_map")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[GET PRODUCT SYNC TIMESTAMP ERROR]", error);
    return null;
  }

  return (data as ProductSyncStatus | null)?.updated_at || null;
}

export async function syncProductOptionsToSupabase(
  products: QuoteProductOption[],
) {
  if (!products.length) return;

  const skus = products.map((product) => product.sku);
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("product_source_map")
    .select("sku, variant_id, product_title, pickup_vendor, image_url, price")
    .in("sku", skus);

  if (existingError) {
    console.error("[GET EXISTING PRODUCT OPTIONS ERROR]", existingError);
    throw existingError;
  }

  const existingBySku = new Map<string, ProductSourceMapRow>(
    ((existingRows as ProductSourceMapRow[] | null) || []).map((row) => [
      row.sku,
      row,
    ]),
  );

  const rows = products.map((product) => {
    const existing = existingBySku.get(product.sku);

    return {
      sku: product.sku,
      variant_id: product.variantId || existing?.variant_id || null,
      product_title: product.title || existing?.product_title || product.sku,
      pickup_vendor: product.vendor || existing?.pickup_vendor || "",
      image_url: product.imageUrl || existing?.image_url || null,
      price:
        product.price === null || product.price === undefined
          ? existing?.price === null || existing?.price === undefined
            ? null
            : Number(existing.price)
          : Number(product.price),
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabaseAdmin
    .from("product_source_map")
    .upsert(rows, { onConflict: "sku" });

  if (error) {
    console.error("[SYNC PRODUCT OPTIONS ERROR]", error);
    throw error;
  }
}

export async function fetchProductOptionsFromShopify(admin: ShopifyAdminClient) {
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
  const products = (json?.data?.products?.nodes || []) as ShopifyProductNode[];
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

export async function ensureProductOptionsFresh(
  admin: ShopifyAdminClient,
  maxAgeMs = 30 * 60 * 1000,
) {
  const lastUpdatedAt = await getLatestProductSyncTimestamp();
  const isStale =
    !lastUpdatedAt || Date.now() - new Date(lastUpdatedAt).getTime() > maxAgeMs;

  if (!isStale) {
    return {
      synced: false,
      syncedCount: 0,
      lastUpdatedAt,
    };
  }

  const products = await fetchProductOptionsFromShopify(admin);
  await syncProductOptionsToSupabase(products);

  return {
    synced: true,
    syncedCount: products.length,
    lastUpdatedAt: new Date().toISOString(),
  };
}
