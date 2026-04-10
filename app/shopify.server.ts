import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { syncProductOptionsToSupabase } from "./lib/quote-products.server";

console.log("SHOPIFY_APP_URL =", process.env.SHOPIFY_APP_URL);
console.log("APP_URL =", process.env.APP_URL);
console.log("HOST =", process.env.HOST);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: true,
  future: {
    expiringOfflineAccessTokens: true,
    unstable_newEmbeddedAuthStrategy: true,
  },
  hooks: {
    afterAuth: async ({ admin, session }) => {
      try {
        console.log("[afterAuth] syncing products for", session.shop);

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
      await admin.graphql(`
      mutation {
        webhookSubscriptionCreate(
          topic: PRODUCTS_UPDATE,
          webhookSubscription: {
            callbackUrl: "https://app.ghstickets.com/webhooks/products/update",
            format: JSON
          }
        ) {
          userErrors {
            field
            message
          }
        }
      }
`);

        const json = await response.json();
        const products = json?.data?.products?.nodes || [];
        const options: Array<{
          title: string;
          sku: string;
          variantId: string;
          vendor: string;
          imageUrl?: string;
          price?: number;
        }> = [];

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
              variantId: variant?.id || "",
              vendor,
              imageUrl: variantImage,
              price:
                variant?.price === null || variant?.price === undefined
                  ? undefined
                  : Number(variant.price),
            });
          }
        }

        await syncProductOptionsToSupabase(options);
        console.log("[afterAuth] synced", options.length, "product variants");
      } catch (error) {
        console.error("[afterAuth] product sync failed", error);
      }

      try {
        await shopify.registerWebhooks({ session });
      } catch (error) {
        console.error("[afterAuth] webhook registration failed", error);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
