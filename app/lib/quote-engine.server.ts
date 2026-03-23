import { supabaseAdmin } from "./supabase.server";
import { getAppSettings } from "./app-settings.server";

/* ---------------- CONFIG ---------------- */

const DEFAULT_MAX_QTY_PER_TRUCK = 22;
const RATE_PER_MINUTE = 2.08;
const MAX_DELIVERY_RADIUS_MILES = 50;
const OUTSIDE_RADIUS_PHONE = "(262) 345-4001";

/* ---------------- CACHE ---------------- */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const TTL_SHORT = 60_000; // 1 min
const TTL_LONG = 10 * 60_000; // 10 min

function getCache<T>(entry: CacheEntry<T> | null): T | null {
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.value;
}

function setCache<T>(value: T, ttl: number): CacheEntry<T> {
  return { value, expiresAt: Date.now() + ttl };
}

let materialRulesCache: CacheEntry<MaterialRule[]> | null = null;
let activeOriginCache: CacheEntry<{ label: string; address: string }> | null = null;
const vendorOriginCache = new Map<string, CacheEntry<any>>();
const distanceCache = new Map<string, CacheEntry<any>>();

/* ---------------- TYPES ---------------- */

type MaterialRule = {
  prefix: string;
  material_name: string;
  truck_capacity: number;
  is_active: boolean;
  sort_order: number;
};

const FALLBACK_MATERIAL_RULES: MaterialRule[] = [
  { prefix: "100", material_name: "Aggregate", truck_capacity: 22, is_active: true, sort_order: 100 },
  { prefix: "300", material_name: "Mulch", truck_capacity: 25, is_active: true, sort_order: 300 },
  { prefix: "400", material_name: "Soil", truck_capacity: 25, is_active: true, sort_order: 400 },
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
  outsideDeliveryArea?: boolean;
  outsideDeliveryMiles?: number;
  outsideDeliveryRadius?: number;
  outsideDeliveryPhone?: string;
};

/* ---------------- HELPERS ---------------- */

async function getMaterialRules(): Promise<MaterialRule[]> {
  const cached = getCache(materialRulesCache);
  if (cached) return cached;

  const { data } = await supabaseAdmin
    .from("shipping_material_rules")
    .select("*")
    .eq("is_active", true);

  const result = data?.length ? data : FALLBACK_MATERIAL_RULES;

  materialRulesCache = setCache(result, TTL_SHORT);
  return result;
}

async function getActiveOriginAddress() {
  const cached = getCache(activeOriginCache);
  if (cached) return cached;

  const { data } = await supabaseAdmin
    .from("origin_addresses")
    .select("label,address")
    .eq("is_active", true)
    .single();

  const result =
    data || {
      label: "Default",
      address: "W185 N7487 Narrow Ln, Menomonee Falls, WI 53051",
    };

  activeOriginCache = setCache(result, TTL_SHORT);
  return result;
}

async function getOriginFromVendor(vendor?: string | null) {
  if (!vendor) return null;

  const cached = vendorOriginCache.get(vendor);
  const val = getCache(cached || null);
  if (val !== null) return val;

  const { data } = await supabaseAdmin
    .from("origin_addresses")
    .select("label,address")
    .ilike("label", vendor)
    .single();

  vendorOriginCache.set(vendor, setCache(data || null, TTL_LONG));
  return data || null;
}

function getMaterialFromSku(sku: string | undefined, rules: MaterialRule[]) {
  const prefix = sku?.match(/^(\d{3})/)?.[1];

  const rule = rules.find((r) => r.prefix === prefix);

  return {
    materialName: rule?.material_name || "Material",
    truckCapacity: rule?.truck_capacity || DEFAULT_MAX_QTY_PER_TRUCK,
  };
}

function buildServiceName(materials: string[], trucks: number) {
  const unique = [...new Set(materials)];

  let base = "Delivery";

  if (unique.length === 1) base = `${unique[0]} Delivery`;
  else if (unique.length > 1) base = "Bulk Material Delivery";

  return trucks > 1 ? `${base} (${trucks} Loads)` : base;
}

function buildDescription(trucks: number) {
  return trucks > 1
    ? `${trucks} truck loads required`
    : "Standard delivery pricing";
}

/* ---------------- DISTANCE ---------------- */

async function getDriveTimeCost(origin: string, dest: string, key: string) {
  const cacheKey = `${origin}|${dest}`;
  const cached = getCache(distanceCache.get(cacheKey) || null);
  if (cached) return cached;

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", dest);
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  const json = await res.json();

  const el = json.rows?.[0]?.elements?.[0];
  if (!el || el.status !== "OK") return null;

  const minutes = (el.duration.value * 2) / 60;
  const miles = el.distance.value / 1609.34;

  const result = {
    costDollars: minutes * RATE_PER_MINUTE,
    oneWayMiles: Math.round(miles * 10) / 10,
  };

  distanceCache.set(cacheKey, setCache(result, TTL_LONG));

  return result;
}

/* ---------------- MAIN ---------------- */

export async function getQuote(input: QuoteInput): Promise<QuoteResult> {
  const settings = await getAppSettings(input.shop);

  if (!settings.enableCalculatedRates) {
    return {
      serviceName: "Delivery Unavailable",
      serviceCode: "CUSTOM_DELIVERY",
      cents: 0,
      description: "Disabled",
      eta: "N/A",
      summary: "Disabled",
    };
  }

  const dest = [
    input.address1,
    input.city,
    input.province,
    input.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Missing Google API key");

  const rules = await getMaterialRules();
  const defaultOrigin = await getActiveOriginAddress();

  /* -------- GROUP ITEMS -------- */

  const groups: Record<string, any> = {};
  const materialLabels: string[] = [];

  for (const item of input.items) {
    if (item.requiresShipping === false) continue;

    const { materialName, truckCapacity } = getMaterialFromSku(item.sku, rules);
    materialLabels.push(materialName);

    const key = `${materialName}-${truckCapacity}-${item.productVendor || "default"}`;

    if (!groups[key]) {
      groups[key] = {
        qty: 0,
        truckCapacity,
        materialName,
        vendor: item.productVendor,
      };
    }

    groups[key].qty += item.quantity || 0;
  }

  let totalCost = 0;
  let totalTrucks = 0;
  let maxMiles = 0;

  for (const g of Object.values(groups)) {
    const trucks = Math.max(1, Math.ceil(g.qty / g.truckCapacity));

    const origin =
      (await getOriginFromVendor(g.vendor)) || defaultOrigin;

    const route = await getDriveTimeCost(origin.address, dest, apiKey);
    if (!route) continue;

    totalCost += route.costDollars * trucks;
    totalTrucks += trucks;

    if (route.oneWayMiles > maxMiles) {
      maxMiles = route.oneWayMiles;
    }
  }

  /* -------- OUTSIDE RADIUS -------- */

  if (maxMiles > MAX_DELIVERY_RADIUS_MILES) {
    return {
      serviceName: "Call for delivery quote",
      serviceCode: "CALL_FOR_QUOTE",
      cents: 1,
      description: "Outside delivery area",
      eta: "Same day",
      summary: "Call required",
      outsideDeliveryArea: true,
      outsideDeliveryMiles: maxMiles,
      outsideDeliveryRadius: MAX_DELIVERY_RADIUS_MILES,
      outsideDeliveryPhone: OUTSIDE_RADIUS_PHONE,
    };
  }

  /* -------- FINAL -------- */

  return {
    serviceName: buildServiceName(materialLabels, totalTrucks),
    serviceCode: "CUSTOM_DELIVERY",
    cents: Math.round(totalCost * 100),
    description: buildDescription(totalTrucks),
    eta: "2–4 business days",
    summary: `Shipping: $${totalCost.toFixed(2)}`,
    outsideDeliveryArea: false,
    outsideDeliveryMiles: maxMiles,
    outsideDeliveryRadius: MAX_DELIVERY_RADIUS_MILES,
    outsideDeliveryPhone: OUTSIDE_RADIUS_PHONE,
  };
}