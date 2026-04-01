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
  vendor_source?: string | null;
  is_active: boolean;
  sort_order: number;
};

const FALLBACK_MATERIAL_RULES: MaterialRule[] = [
  {
    prefix: "100",
    material_name: "Aggregate",
    truck_capacity: 22,
    vendor_source: "Aggregate Yard",
    is_active: true,
    sort_order: 100,
  },
  {
    prefix: "300",
    material_name: "Mulch",
    truck_capacity: 25,
    vendor_source: "Mulch Yard",
    is_active: true,
    sort_order: 300,
  },
  {
    prefix: "400",
    material_name: "Soil",
    truck_capacity: 25,
    vendor_source: "Soil Yard",
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
    pickupVendor?: string;
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

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const TTL_SHORT = 60_000;
const TTL_LONG = 10 * 60_000;

function getCache<T>(entry: CacheEntry<T> | null): T | null {
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.value;
}

function setCache<T>(value: T, ttlMs: number): CacheEntry<T> {
  return {
    value,
    expiresAt: Date.now() + ttlMs,
  };
}

let materialRulesCache: CacheEntry<MaterialRule[]> | null = null;
let activeOriginCache: CacheEntry<{ label: string; address: string }> | null = null;
const vendorOriginCache = new Map<
  string,
  CacheEntry<{ label: string; address: string } | null>
>();
const legDistanceCache = new Map<
  string,
  CacheEntry<{
    minutes: number;
    miles: number;
    durationText: string;
  } | null>
>();

async function getActiveOriginAddress(): Promise<{ label: string; address: string }> {
  const cached = getCache(activeOriginCache);
  if (cached) return cached;

  const { data } = await supabaseAdmin
    .from("origin_addresses")
    .select("label, address")
    .eq("is_active", true)
    .limit(1)
    .single();

  const result =
    data || {
      label: "Menomonee Falls",
      address: "W185 N7487 Narrow Ln, Menomonee Falls, WI 53051",
    };

  activeOriginCache = setCache(result, TTL_SHORT);
  return result;
}

async function getOriginFromVendorLabel(
  vendorLabel?: string | null,
): Promise<{ label: string; address: string } | null> {
  if (!vendorLabel) return null;

  const cacheKey = vendorLabel.trim().toLowerCase();
  const cached = vendorOriginCache.get(cacheKey);
  const cachedValue = getCache(cached || null);
  if (cachedValue !== null) return cachedValue;

  const { data } = await supabaseAdmin
    .from("origin_addresses")
    .select("label, address")
    .ilike("label", vendorLabel)
    .limit(1)
    .single();

  const result = data || null;
  vendorOriginCache.set(cacheKey, setCache(result, TTL_LONG));
  return result;
}

async function getMaterialRules(): Promise<MaterialRule[]> {
  const cached = getCache(materialRulesCache);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from("shipping_material_rules")
    .select("prefix, material_name, truck_capacity, vendor_source, is_active, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const result =
    error || !data || data.length === 0 ? FALLBACK_MATERIAL_RULES : data;

  materialRulesCache = setCache(result, TTL_SHORT);
  return result;
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
  fallbackVendorSource: string;
} {
  const normalizedSku = normalizeSku(sku);
  const match = normalizedSku.match(/^(\d{3})/);
  const prefix = match ? match[1] : null;

  if (!prefix) {
    return {
      prefix: null,
      materialName: "Material",
      truckCapacity: DEFAULT_MAX_QTY_PER_TRUCK,
      fallbackVendorSource: "",
    };
  }

  const rule = rules.find((r) => r.prefix === prefix);

  if (!rule) {
    return {
      prefix,
      materialName: "Material",
      truckCapacity: DEFAULT_MAX_QTY_PER_TRUCK,
      fallbackVendorSource: "",
    };
  }

  return {
    prefix,
    materialName: rule.material_name,
    truckCapacity: Number(rule.truck_capacity) || DEFAULT_MAX_QTY_PER_TRUCK,
    fallbackVendorSource: rule.vendor_source || "",
  };
}

function buildServiceName(materialNames: string[], totalTrucks: number): string {
  const uniqueMaterials = Array.from(new Set(materialNames))
    .map((name) => (name || "").trim())
    .filter(Boolean);

  let baseName = "Green Hills Delivery";

  if (uniqueMaterials.length === 1) {
    baseName = `${uniqueMaterials[0]} Delivery`;
  } else if (uniqueMaterials.length > 1) {
    baseName = "Bulk Material Delivery";
  }

  if (totalTrucks > 1) {
    return `${baseName} (${totalTrucks} Loads)`;
  }

  return baseName;
}

function buildServiceDescription(totalTrucks: number, sourceText: string): string {
  const baseDescription =
    totalTrucks > 1
      ? `${totalTrucks} truck loads required for this order`
      : "Standard delivery pricing";

  return `${baseDescription}${sourceText ? sourceText : ""}`;
}

async function getLegDistance(
  originAddress: string,
  destinationAddress: string,
  googleMapsApiKey: string,
): Promise<{
  minutes: number;
  miles: number;
  durationText: string;
} | null> {
  const cacheKey = `${originAddress}|${destinationAddress}`;
  const cached = legDistanceCache.get(cacheKey);
  const cachedValue = getCache(cached || null);
  if (cachedValue !== null) return cachedValue;

  const mapsUrl = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  mapsUrl.searchParams.set("origins", originAddress);
  mapsUrl.searchParams.set("destinations", destinationAddress);
  mapsUrl.searchParams.set("key", googleMapsApiKey);
  mapsUrl.searchParams.set("units", "imperial");

  const mapsRes = await fetch(mapsUrl.toString());
  const mapsData = await mapsRes.json();

  if (mapsData.status !== "OK") {
    legDistanceCache.set(cacheKey, setCache(null, TTL_SHORT));
    return null;
  }

  const element = mapsData.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK") {
    legDistanceCache.set(cacheKey, setCache(null, TTL_SHORT));
    return null;
  }

  const result = {
    minutes: element.duration.value / 60,
    miles: Math.round((element.distance.value / 1609.34) * 10) / 10,
    durationText: element.duration.text,
  };

  legDistanceCache.set(cacheKey, setCache(result, TTL_LONG));
  return result;
}

async function getLoopRouteCost(
  yardAddress: string,
  pickupAddress: string,
  customerAddress: string,
  googleMapsApiKey: string,
): Promise<{
  costDollars: number;
  oneWayMilesForRadiusCheck: number;
  totalLoopMiles: number;
  totalLoopMinutes: number;
} | null> {
  const yardToPickup = await getLegDistance(yardAddress, pickupAddress, googleMapsApiKey);
  if (!yardToPickup) return null;

  const pickupToCustomer = await getLegDistance(
    pickupAddress,
    customerAddress,
    googleMapsApiKey,
  );
  if (!pickupToCustomer) return null;

  const customerToYard = await getLegDistance(customerAddress, yardAddress, googleMapsApiKey);
  if (!customerToYard) return null;

  const totalLoopMinutes =
    yardToPickup.minutes + pickupToCustomer.minutes + customerToYard.minutes;

  const totalLoopMiles =
    yardToPickup.miles + pickupToCustomer.miles + customerToYard.miles;

  return {
    costDollars: totalLoopMinutes * RATE_PER_MINUTE,
    oneWayMilesForRadiusCheck: pickupToCustomer.miles,
    totalLoopMiles,
    totalLoopMinutes,
  };
}

export async function getQuote(input: QuoteInput): Promise<QuoteResult> {
  const settings = await getAppSettings(input.shop);

  if (!settings.enableCalculatedRates) {
    return {
      serviceName: "Delivery Unavailable",
      serviceCode: "CUSTOM_DELIVERY",
      cents: 0,
      description: "Calculated delivery rates are currently disabled",
      eta: "Unavailable",
      summary: "Calculated delivery rates are currently disabled",
    };
  }

  if (settings.useTestFlatRate) {
    return {
      serviceName: "Test Delivery Rate",
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

  const customerAddress = destinationParts.join(", ");

  if (!customerAddress) {
    return {
      serviceName: "Delivery Unavailable",
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
      serviceName: "Delivery Unavailable",
      serviceCode: "CUSTOM_DELIVERY",
      cents: 0,
      description: "Google Maps API key is not configured",
      eta: "Unavailable",
      summary: "Google Maps API key is not configured",
    };
  }

  const materialRules = await getMaterialRules();
  const defaultYard = await getActiveOriginAddress();
  const shippableItems = input.items.filter((item) => item.requiresShipping !== false);

  const groupedItems: Record<
    string,
    {
      qty: number;
      materialName: string;
      truckCapacity: number;
      pickupVendor: string;
      pickupAddress: string;
    }
  > = {};

  const materialLabels: string[] = [];
  const sourceLabels: string[] = [];

  for (const item of shippableItems) {
    const itemQty = item.quantity || 1;

    const {
      prefix,
      materialName,
      truckCapacity,
      fallbackVendorSource,
    } = getMaterialFromSku(item.sku, materialRules);

    const pickupVendorLabel = item.pickupVendor || fallbackVendorSource || defaultYard.label;
    const pickupOrigin =
      (await getOriginFromVendorLabel(pickupVendorLabel)) || defaultYard;

    materialLabels.push(materialName);

    if (settings.showVendorSource && pickupOrigin.label) {
      sourceLabels.push(pickupOrigin.label);
    }

    const groupKey = [
      pickupOrigin.address,
      pickupOrigin.label,
      materialName,
      truckCapacity,
    ].join("|");

    if (!groupedItems[groupKey]) {
      groupedItems[groupKey] = {
        qty: 0,
        materialName,
        truckCapacity,
        pickupVendor: pickupOrigin.label,
        pickupAddress: pickupOrigin.address,
      };
    }

    groupedItems[groupKey].qty += itemQty;

    if (settings.enableDebugLogging) {
      console.log(
        `[QUOTE ITEM] prefix=${prefix || "none"} sku=${item.sku || "none"} material=${materialName} pickupVendor=${pickupOrigin.label} qty=${itemQty} capacity=${truckCapacity}`,
      );
    }
  }

  let totalDeliveryCostCents = 0;
  let totalTrucks = 0;
  let maxOneWayMiles = 0;

  for (const group of Object.values(groupedItems)) {
    const trucksForGroup = Math.max(1, Math.ceil(group.qty / group.truckCapacity));

    const routeCost = await getLoopRouteCost(
      defaultYard.address,
      group.pickupAddress,
      customerAddress,
      googleMapsApiKey,
    );

    if (!routeCost) continue;

    if (routeCost.oneWayMilesForRadiusCheck > maxOneWayMiles) {
      maxOneWayMiles = routeCost.oneWayMilesForRadiusCheck;
    }

    let groupCostDollars = routeCost.costDollars * trucksForGroup;

    if (settings.enableRemoteSurcharge && input.postalCode.startsWith("9")) {
      groupCostDollars += 3;
    }

    totalDeliveryCostCents += Math.round(groupCostDollars * 100);
    totalTrucks += trucksForGroup;

    if (settings.enableDebugLogging) {
      console.log(
        `[QUOTE GROUP] source=${group.pickupVendor} material=${group.materialName} qty=${group.qty} capacity=${group.truckCapacity} trucks=${trucksForGroup} customerMiles=${routeCost.oneWayMilesForRadiusCheck} loopMiles=${routeCost.totalLoopMiles} cost=${groupCostDollars.toFixed(2)}`,
      );
    }
  }

  if (totalTrucks === 0) {
    const fallbackLoop = await getLoopRouteCost(
      defaultYard.address,
      defaultYard.address,
      customerAddress,
      googleMapsApiKey,
    );

    if (fallbackLoop) {
      maxOneWayMiles = fallbackLoop.oneWayMilesForRadiusCheck;

      let fallbackDollars = fallbackLoop.costDollars;
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

  const uniqueSources = Array.from(new Set(sourceLabels)).filter(Boolean);
  const sourceText =
    settings.showVendorSource && uniqueSources.length > 0
      ? ` Source: ${uniqueSources.join(", ")}.`
      : "";

  const serviceName = buildServiceName(materialLabels, totalTrucks);
  const description = buildServiceDescription(totalTrucks, sourceText);

  return {
    serviceName,
    serviceCode: "CUSTOM_DELIVERY",
    cents: totalDeliveryCostCents,
    description,
    eta: "2–4 business days",
    summary: `Shipping: $${(totalDeliveryCostCents / 100).toFixed(2)}`,
    outsideDeliveryArea: false,
    outsideDeliveryMiles: maxOneWayMiles,
    outsideDeliveryRadius: MAX_DELIVERY_RADIUS_MILES,
    outsideDeliveryPhone: OUTSIDE_RADIUS_PHONE,
  };
}