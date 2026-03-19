import { supabaseAdmin } from "./supabase.server";
import { getAppSettings } from "./app-settings.server";

const DEFAULT_MAX_QTY_PER_TRUCK = 22;
const RATE_PER_MINUTE = 2.08;
const MAX_DELIVERY_RADIUS_MILES = 50;
const OUTSIDE_RADIUS_PHONE = "(262) 345-4001";

type MaterialRule = {
  prefix: string;
  material_name: string;
  truck_capacity: number;
  is_active: boolean;
  sort_order: number;
};

const FALLBACK_MATERIAL_RULES: MaterialRule[] = [
  {
    prefix: "100",
    material_name: "Aggregate",
    truck_capacity: 22,
    is_active: true,
    sort_order: 100,
  },
  {
    prefix: "300",
    material_name: "Mulch",
    truck_capacity: 25,
    is_active: true,
    sort_order: 300,
  },
  {
    prefix: "400",
    material_name: "Soil",
    truck_capacity: 25,
    is_active: true,
    sort_order: 400,
  },
];

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
    productCategory?: string;
  }>;
};

export type QuoteResult = {
  serviceName: string;
  serviceCode: string;
  cents: number;
  description: string;
  eta: string;
  summary: string;
  outsideDeliveryArea?: boolean;
  outsideDeliveryMiles?: number;
  outsideDeliveryRadius?: number;
  outsideDeliveryPhone?: string;
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
      address: "W185 N7487 Narrow Ln, Menomonee Falls, WI 53051",
    }
  );
}

async function getOriginFromVendor(
  vendor?: string | null,
): Promise<{ label: string; address: string } | null> {
  if (!vendor) return null;

  const { data } = await supabaseAdmin
    .from("origin_addresses")
    .select("label, address")
    .ilike("label", vendor)
    .limit(1)
    .single();

  return data || null;
}

async function getMaterialRules(): Promise<MaterialRule[]> {
  const { data, error } = await supabaseAdmin
    .from("shipping_material_rules")
    .select("prefix, material_name, truck_capacity, is_active, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error || !data || data.length === 0) {
    return FALLBACK_MATERIAL_RULES;
  }

  return data;
}

function normalizeSku(value?: string | null): string {
  return (value || "").trim();
}

function getMaterialFromSku(
  sku: string | undefined,
  rules: MaterialRule[],
): {
  prefix: string | null;
  materialName: string;
  truckCapacity: number;
} {
  const normalizedSku = normalizeSku(sku);
  const match = normalizedSku.match(/^(\d{3})/);
  const prefix = match ? match[1] : null;

  if (!prefix) {
    return {
      prefix: null,
      materialName: "Default",
      truckCapacity: DEFAULT_MAX_QTY_PER_TRUCK,
    };
  }

  const rule = rules.find((r) => r.prefix === prefix);

  if (!rule) {
    return {
      prefix,
      materialName: "Default",
      truckCapacity: DEFAULT_MAX_QTY_PER_TRUCK,
    };
  }

  return {
    prefix,
    materialName: rule.material_name,
    truckCapacity: Number(rule.truck_capacity) || DEFAULT_MAX_QTY_PER_TRUCK,
  };
}

async function getDriveTimeCost(
  originAddress: string,
  destinationAddress: string,
  googleMapsApiKey: string,
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

  if (mapsData.status !== "OK") return null;

  const element = mapsData.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK") return null;

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

  const materialRules = await getMaterialRules();
  const defaultOrigin = await getActiveOriginAddress();
  const shippableItems = input.items.filter((item) => item.requiresShipping !== false);

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
  let maxOneWayMiles = 0;

  for (const item of shippableItems) {
    const itemQty = item.quantity || 1;

    const {
      prefix,
      materialName,
      truckCapacity,
    } = getMaterialFromSku(item.sku, materialRules);

    const trucksForItem = Math.max(1, Math.ceil(itemQty / truckCapacity));

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
      const result = await getDriveTimeCost(
        origin.address,
        destinationAddress,
        googleMapsApiKey,
      );

      if (!result) continue;

      routeCache[cacheKey] = result;
      routeCost = result;
    }

    if (routeCost.oneWayMiles > maxOneWayMiles) {
      maxOneWayMiles = routeCost.oneWayMiles;
    }

    let itemCostDollars = routeCost.costDollars * trucksForItem;

    if (settings.enableRemoteSurcharge && input.postalCode.startsWith("9")) {
      itemCostDollars += 3;
    }

    totalDeliveryCostCents += Math.round(itemCostDollars * 100);
    totalTrucks += trucksForItem;

    if (settings.enableDebugLogging) {
      console.log(
        `[QUOTE] material=${materialName} prefix=${prefix || "none"} sku=${item.sku || "none"} qty=${itemQty} capacity=${truckCapacity} trucks=${trucksForItem} miles=${routeCost.oneWayMiles} cost=${itemCostDollars.toFixed(2)}`,
      );
    }
  }

  if (totalTrucks === 0) {
    const fallback = await getDriveTimeCost(
      defaultOrigin.address,
      destinationAddress,
      googleMapsApiKey,
    );

    if (fallback) {
      maxOneWayMiles = fallback.oneWayMiles;

      let fallbackDollars = fallback.costDollars;
      if (settings.enableRemoteSurcharge && input.postalCode.startsWith("9")) {
        fallbackDollars += 3;
      }

      totalDeliveryCostCents = Math.round(fallbackDollars * 100);
      totalTrucks = 1;
    }
  }

  if (maxOneWayMiles > MAX_DELIVERY_RADIUS_MILES) {
    return {
      serviceName: "Call for delivery quote",
      serviceCode: "CALL_FOR_QUOTE",
      cents: 1,
      description: "Outside delivery area — please call for custom quote",
      eta: "Same business day",
      summary: "Custom delivery quote required",
      outsideDeliveryArea: true,
      outsideDeliveryMiles: maxOneWayMiles,
      outsideDeliveryRadius: MAX_DELIVERY_RADIUS_MILES,
      outsideDeliveryPhone: OUTSIDE_RADIUS_PHONE,
    };
  }

  const uniqueVendors = Array.from(new Set(vendorLabels)).filter(Boolean);
  const vendorText =
    settings.showVendorSource && uniqueVendors.length > 0
      ? ` Vendor source: ${uniqueVendors.join(", ")}.`
      : "";

  return {
    serviceName: "Green Hills Delivery Fee",
    serviceCode: "CUSTOM_DELIVERY",
    cents: totalDeliveryCostCents,
    description:
      totalTrucks > 1
        ? `Delivery (${totalTrucks} loads required).${vendorText}`
        : `Standard delivery pricing.${vendorText}`,
    eta: "2–4 business days",
    summary: `Shipping calculated from your address: $${(totalDeliveryCostCents / 100).toFixed(2)}`,
    outsideDeliveryArea: false,
    outsideDeliveryMiles: maxOneWayMiles,
    outsideDeliveryRadius: MAX_DELIVERY_RADIUS_MILES,
    outsideDeliveryPhone: OUTSIDE_RADIUS_PHONE,
  };
}