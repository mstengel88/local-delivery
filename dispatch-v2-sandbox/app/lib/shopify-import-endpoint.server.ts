import { data } from "react-router";
import {
  importRecentShopifyOrders,
  loadDispatchOperationalSettings,
  type ShopifyImportMode,
} from "./dispatch.server";

const DISPATCH_IMPORT_SECRET = process.env.DISPATCH_IMPORT_SECRET || "";

async function getImportOptions(request: Request, forcedMode?: ShopifyImportMode) {
  const url = new URL(request.url);
  const operations = await loadDispatchOperationalSettings().catch(() => null);
  const limit = Number(url.searchParams.get("limit") || operations?.defaultImportLimit || 50);
  const sinceDays = Number(url.searchParams.get("sinceDays") || operations?.defaultImportSinceDays || 7);
  const calculateDistancesParam = url.searchParams.get("calculateDistances");
  const mode = (forcedMode || String(url.searchParams.get("mode") || "new")) as ShopifyImportMode;

  return {
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 250)) : 50,
    sinceDays: Number.isFinite(sinceDays) ? Math.max(1, Math.min(sinceDays, 60)) : 7,
    mode: mode === "updates" || mode === "sync" ? mode : "new",
    calculateDistances:
      calculateDistancesParam === null
        ? Boolean(operations?.calculateDistancesOnImport)
        : calculateDistancesParam === "1",
    distanceLimit: Number(url.searchParams.get("distanceLimit") || operations?.distanceLimit || 10),
  };
}

function assertAuthorized(request: Request) {
  if (!DISPATCH_IMPORT_SECRET) {
    return "DISPATCH_IMPORT_SECRET is not configured.";
  }

  const url = new URL(request.url);
  const providedSecret =
    request.headers.get("x-dispatch-secret") ||
    request.headers.get("x-import-secret") ||
    url.searchParams.get("secret") ||
    "";

  if (providedSecret !== DISPATCH_IMPORT_SECRET) {
    return "Unauthorized Shopify import request.";
  }

  return "";
}

export async function runShopifyImportEndpoint(request: Request, forcedMode?: ShopifyImportMode) {
  const authorizationError = assertAuthorized(request);
  if (authorizationError) {
    return data({ ok: false, message: authorizationError }, { status: authorizationError.startsWith("Unauthorized") ? 401 : 500 });
  }

  try {
    const result = await importRecentShopifyOrders(await getImportOptions(request, forcedMode));
    return data({
      ...result,
      ranAt: new Date().toISOString(),
    });
  } catch (error) {
    return data(
      {
        ok: false,
        imported: 0,
        updated: 0,
        skipped: 0,
        message: error instanceof Error ? error.message : "Shopify import failed.",
        details: [],
        ranAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
