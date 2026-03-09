import { supabaseAdmin } from "./supabase.server";
import { getAppSettings } from "./app-settings.server";

const MAX_QTY_PER_TRUCK = 22;
const RATE_PER_MINUTE = 2.08;

export type QuoteInput = {
  shop: string;
  postalCode: string;
  country: string;
  province?: string;
  city?: string;
  address1?: string;
  address2?: string;
  items: Array<{
    sku?: string;
    quantity: number;
    grams?: number;
    price?: number;
    requiresShipping?: boolean;
    productVendor?: string;
  }>;
};

export type QuoteResult = {
  serviceName: string;
  serviceCode: string;
  cents: number;
  description: string;
  eta: string;
  summary: string;
};

async function getActiveOriginAddress(): Promise<{ label: string; address: string }> {
  const { data } = await supabaseAdmin
    .from("origin_addresses")
    .select("label, address")
    .eq("is_active", true)
    .limit(1)
    .single();

  return (
    data || {
      label: "Menomonee Falls",
      address: "W185 N7487, Narrow Ln, Menomonee Falls, WI 53051",
    }
  );
}

async function getOriginFromVendor(vendor?: string | null): Promise<{ label: string; address: string } | null> {
  if (!vendor) return null;

  const { data } = await supabaseAdmin
    .from("origin_addresses")
    .select("label, address")
    .ilike("label", vendor)
    .limit(1)
    .single();

  return data || null;
}

async function getDriveTimeCost(
  originAddress: string,
  destinationAddress: string,
  googleMapsApiKey: string
): Promise<{
  costDollars: number;
  oneWayMiles: number;
  durationText: string;
  roundTripMinutes: number;
} | null> {
  const mapsUrl = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  mapsUrl.searchParams.set("origins", originAddress);
  mapsUrl.searchParams.set("destinations", destinationAddress);
  mapsUrl.searchParams.set("key", googleMapsApiKey);
  mapsUrl.searchParams.set("units", "imperial");

  const mapsRes = await fetch(mapsUrl.toString());
  const mapsData = await mapsRes.json();

  if (mapsData.status !== "OK") {
    return null;
  }

  const element = mapsData.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK") {
    return null;
  }

  const oneWaySeconds = element.duration.value;
  const roundTripMinutes = (oneWaySeconds * 2) / 60;
  const costDollars = roundTripMinutes * RATE_PER_MINUTE;
  const oneWayMiles = Math.round((element.distance.value / 1609.34) * 10) / 10;

  return {
    costDollars,
    oneWayMiles,
    durationText: element.duration.text,
    roundTripMinutes,
  };
}

export async function getQuote(input: QuoteInput): Promise<QuoteResult> {
  const settings = await getAppSettings(input.shop);

  if (!settings.enableCalculatedRates) {
    return {
      serviceName: "Custom Delivery",
      serviceCode: "CUSTOM_DELIVERY",
      cents: 0,
      description: "Calculated delivery rates are currently disabled",
      eta: "Unavailable",
      summary: "Calculated delivery rates are currently disabled",
    };
  }

  if (settings.useTestFlatRate) {
    return {
      serviceName: "Custom Delivery",
      serviceCode: "CUSTOM_DELIVERY",
      cents: settings.testFlatRateCents,
      description: "Test flat rate enabled",
      eta: "2–4 business days",
      summary: `Test flat rate: $${(settings.testFlatRateCents / 100).toFixed(2)}`,
    };
  }

  const destinationParts = [
    input.address1,
    input.address2,
    input.city,
    input.province,
    input.postalCode,
    input.country,
  ].filter(Boolean);

  const destinationAddress = destinationParts.join(", ");

  if (!destinationAddress) {
    return {
      serviceName: "Custom Delivery",
      serviceCode: "CUSTOM_DELIVERY",
      cents: 0,
      description: "Missing destination address",
      eta: "Unavailable",
      summary: "Missing destination address",
    };
  }

  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    return {
      serviceName: "Custom Delivery",
      serviceCode: "CUSTOM_DELIVERY",
      cents: 0,
      description: "Google Maps API key is not configured",
      eta: "Unavailable",
      summary: "Google Maps API key is not configured",
    };
  }

  const defaultOrigin = await getActiveOriginAddress();
  const routeCache: Record<
    string,
    {
      costDollars: number;
      oneWayMiles: number;
      durationText: string;
      roundTripMinutes: number;
    }
  > = {};

  let totalDeliveryCostCents = 0;
  let totalTrucks = 0;
  const vendorLabels: string[] = [];

  const shippableItems = input.items.filter((item) => item.requiresShipping !== false);

  for (const item of shippableItems) {
    const itemQty = item.quantity || 1;
    const trucksForItem = Math.max(1, Math.ceil(itemQty / MAX_QTY_PER_TRUCK));

    let origin = defaultOrigin;

    if (item.productVendor) {
      const vendorOrigin = await getOriginFromVendor(item.productVendor);
      if (vendorOrigin) {
        origin = vendorOrigin;
        if (settings.showVendorSource) {
          vendorLabels.push(item.productVendor);
        }
      }
    }

    const cacheKey = `${origin.address}|${destinationAddress}`;
    let routeCost = routeCache[cacheKey];

    if (!routeCost) {
      const result = await getDriveTimeCost(origin.address, destinationAddress, googleMapsApiKey);
      if (!result) continue;
      routeCache[cacheKey] = result;
      routeCost = result;
    }

    let itemCostDollars = routeCost.costDollars * trucksForItem;

    if (settings.enableRemoteSurcharge && input.postalCode.startsWith("9")) {
      itemCostDollars += 3;
    }

    totalDeliveryCostCents += Math.round(itemCostDollars * 100);
    totalTrucks += trucksForItem;

    if (settings.enableDebugLogging) {
      console.log(
        `[QUOTE] vendor=${item.productVendor || "default"} qty=${itemQty} trucks=${trucksForItem} cost=${itemCostDollars.toFixed(2)}`
      );
    }
  }

  if (totalTrucks === 0) {
    const fallback = await getDriveTimeCost(defaultOrigin.address, destinationAddress, googleMapsApiKey);

    if (fallback) {
      let fallbackDollars = fallback.costDollars;

      if (settings.enableRemoteSurcharge && input.postalCode.startsWith("9")) {
        fallbackDollars += 3;
      }

      totalDeliveryCostCents = Math.round(fallbackDollars * 100);
      totalTrucks = 1;
    }
  }

  const vendorText =
    settings.showVendorSource && vendorLabels.length > 0
      ? ` Vendor source: ${Array.from(new Set(vendorLabels)).join(", ")}.`
      : "";

  return {
    serviceName: "Custom Delivery",
    serviceCode: "CUSTOM_DELIVERY",
    cents: totalDeliveryCostCents,
    description:
      totalTrucks > 1
        ? `Delivery (${totalTrucks} loads required).${vendorText}`
        : `Standard delivery pricing.${vendorText}`,
    eta: "2–4 business days",
    summary: `Shipping calculated from your address: $${(totalDeliveryCostCents / 100).toFixed(2)}`,
  };
}
