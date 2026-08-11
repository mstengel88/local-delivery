import type { PrismaClient } from "@prisma/client";

type TokenResponse = {
  access_token?: string;
  scope?: string;
  expires_in?: number;
};

const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const MINIMUM_TOKEN_LIFETIME_SECONDS = 300;
const refreshes = new Map<string, Promise<void>>();

function normalizeShop(value: string) {
  return value.trim().toLowerCase();
}

function configuredShop() {
  return normalizeShop(process.env.SHOPIFY_STORE_DOMAIN || "");
}

function sessionNeedsRefresh(expires: Date | null) {
  return Boolean(
    expires && expires.getTime() <= Date.now() + REFRESH_WINDOW_MS,
  );
}

async function refreshOfflineSession(prisma: PrismaClient, shop: string) {
  const clientId = process.env.SHOPIFY_API_KEY || "";
  const clientSecret = process.env.SHOPIFY_API_SECRET || "";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Shopify client credentials are required to create the offline session.",
    );
  }

  const response = await fetch(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Shopify client-credentials exchange failed with HTTP ${response.status}.`,
    );
  }

  const token = (await response.json()) as TokenResponse;
  if (!token.access_token) {
    throw new Error("Shopify returned an empty client-credentials token.");
  }

  const expiresIn = Math.max(
    Number(token.expires_in) || 0,
    MINIMUM_TOKEN_LIFETIME_SECONDS,
  );
  const expires = new Date(Date.now() + expiresIn * 1000);

  await prisma.session.upsert({
    where: { id: `offline_${shop}` },
    create: {
      id: `offline_${shop}`,
      shop,
      state: "",
      isOnline: false,
      scope: token.scope || null,
      expires,
      accessToken: token.access_token,
    },
    update: {
      shop,
      isOnline: false,
      scope: token.scope || null,
      expires,
      accessToken: token.access_token,
    },
  });

  console.info(
    `[SHOPIFY SESSION] Refreshed client-credentials session for ${shop}.`,
  );
}

export async function ensureShopifyOfflineSession(
  prisma: PrismaClient,
  requestedShop: string,
) {
  const shop = normalizeShop(requestedShop);
  const allowedShop = configuredShop();

  if (!shop || !allowedShop || shop !== allowedShop) return;

  const existing = await prisma.session.findUnique({
    where: { id: `offline_${shop}` },
    select: { accessToken: true, expires: true },
  });

  if (
    existing?.accessToken &&
    (!existing.expires || !sessionNeedsRefresh(existing.expires))
  ) {
    return;
  }

  const activeRefresh = refreshes.get(shop);
  if (activeRefresh) return activeRefresh;

  const refresh = refreshOfflineSession(prisma, shop).finally(() => {
    refreshes.delete(shop);
  });
  refreshes.set(shop, refresh);
  return refresh;
}
