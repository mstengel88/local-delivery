import { data } from "react-router";
import { authenticate } from "../shopify.server";
import {
  fetchProductOptionsFromShopify,
  syncProductOptionsToSupabase,
} from "../lib/quote-products.server";

export async function action({ request }: any) {
  const { admin, session } = await authenticate.admin(request);

  try {
    const products = await fetchProductOptionsFromShopify(admin);
    await syncProductOptionsToSupabase(products);

    console.log(
      "[SYNC PRODUCTS]",
      session.shop,
      "synced",
      products.length,
      "variants",
      "unit labels",
      products.filter((product) => product.unitLabel).length,
    );

    return data({
      ok: true,
      shop: session.shop,
      syncedCount: products.length,
      syncedUnitLabelCount: products.filter((product) => product.unitLabel).length,
    });
  } catch (error: any) {
    console.error("[SYNC PRODUCTS ERROR]", error);

    return data(
      {
        ok: false,
        message: error?.message || "Failed to sync products",
      },
      { status: 500 },
    );
  }
}
