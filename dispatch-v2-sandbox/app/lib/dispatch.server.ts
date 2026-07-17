import { createClient } from "@supabase/supabase-js";
import type { RealtimeClientOptions } from "@supabase/realtime-js";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SHOPIFY_SHOP_DOMAIN = (
  process.env.SHOPIFY_SHOP_DOMAIN ||
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.SHOPIFY_SHOP ||
  ""
).trim();
const SHOPIFY_ADMIN_ACCESS_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
const SHOPIFY_API_KEY = (process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID || "").trim();
const SHOPIFY_API_SECRET = (
  process.env.SHOPIFY_API_SECRET ||
  process.env.SHOPIFY_API_SECRET_KEY ||
  process.env.SHOPIFY_CLIENT_SECRET ||
  process.env.SHOPIFY_CLIENT_SECRET_KEY ||
  ""
).trim();
const SHOPIFY_API_VERSION = (process.env.SHOPIFY_API_VERSION || "2026-01").trim();
const GOOGLE_MAPS_API_KEY = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
const GOOGLE_MAPS_BROWSER_API_KEY = (process.env.GOOGLE_MAPS_BROWSER_API_KEY || "").trim();
const DISPATCH_PHOTO_BUCKET = (process.env.DISPATCH_PHOTO_BUCKET || "dispatch-photos").trim();
const DISPATCH_SHOP_ADDRESS = (
  process.env.DISPATCH_SHOP_ADDRESS ||
  "Green Hills Supply, W185N7487 Narrow Lane, Menomonee Falls, WI 53051"
).trim();
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const DISPATCH_EMAIL_FROM = (
  process.env.DISPATCH_EMAIL_FROM ||
  process.env.DELIVERY_EMAIL_FROM ||
  process.env.DELIVERY_CONFIRMATION_FROM ||
  ""
).trim();
const DISPATCH_EMAIL_REPLY_TO = (
  process.env.DISPATCH_EMAIL_REPLY_TO ||
  process.env.DELIVERY_EMAIL_REPLY_TO ||
  process.env.DELIVERY_CONFIRMATION_REPLY_TO ||
  ""
).trim();
const PUBLIC_APP_URL = (
  process.env.PUBLIC_APP_URL ||
  process.env.APP_URL ||
  process.env.SHOPIFY_APP_URL ||
  "https://dispatch.winterwatch-pro.info"
).replace(/\/+$/, "");

let cachedShopifyAccessToken = "";
let cachedShopifyAccessTokenExpiresAt = 0;
let cachedDispatchTimingInsights:
  | { limit: number; expiresAt: number; insights: DispatchTimingInsights }
  | null = null;
let dispatchPhotoBucketReady: Promise<void> | null = null;

const TIMING_INSIGHTS_CACHE_MS = 30_000;

if (!SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseRealtimeTransport = WebSocket as unknown as NonNullable<
  RealtimeClientOptions["transport"]
>;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
  realtime: { transport: supabaseRealtimeTransport },
});

const ORDER_COLUMNS = [
  "id",
  "order_number",
  "source",
  "customer",
  "contact",
  "address",
  "city",
  "material",
  "quantity",
  "unit",
  "requested_window",
  "time_preference",
  "status",
  "assigned_route_id",
  "stop_sequence",
  "delivery_status",
  "eta",
  "travel_minutes",
  "travel_miles",
  "departed_at",
  "delivered_at",
  "proof_name",
  "proof_notes",
  "signature_data",
  "photo_urls",
  "checklist_json",
  "created_at",
  "updated_at",
].join(", ");

const ORDER_LIST_COLUMNS = [
  "id",
  "order_number",
  "source",
  "customer",
  "contact",
  "address",
  "city",
  "material",
  "quantity",
  "unit",
  "requested_window",
  "time_preference",
  "status",
  "assigned_route_id",
  "stop_sequence",
  "delivery_status",
  "eta",
  "travel_minutes",
  "travel_miles",
  "departed_at",
  "delivered_at",
  "proof_name",
  "proof_notes",
  "created_at",
  "updated_at",
].join(", ");

const ROUTE_COLUMNS = [
  "id",
  "code",
  "truck_id",
  "truck",
  "driver_id",
  "driver",
  "helper_id",
  "helper",
  "color",
  "shift",
  "region",
  "is_active",
  "created_at",
  "updated_at",
].join(", ");

const TRUCK_COLUMNS = [
  "id",
  "truck_number",
  "name",
  "tons",
  "yards",
  "is_active",
  "notes",
  "created_at",
  "updated_at",
].join(", ");

const STOP_METRICS_TABLE = "dispatch_stop_metrics";

export type DispatchOrder = {
  id: string;
  orderNumber: string;
  customer: string;
  contact: string;
  address: string;
  city: string;
  material: string;
  quantity: string;
  unit: string;
  requestedWindow: string;
  timePreference: string;
  status: "new" | "scheduled" | "hold" | "delivered" | "cancelled";
  assignedRouteId: string | null;
  stopSequence: number | null;
  deliveryStatus: "not_started" | "en_route" | "delivered";
  eta: string | null;
  travelMinutes: number | null;
  travelMiles: number | null;
  departedAt: string | null;
  deliveredAt: string | null;
  proofName: string | null;
  proofNotes: string | null;
  signatureData: string | null;
  photoUrls: string | null;
  checklistJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DispatchRoute = {
  id: string;
  code: string;
  truckId: string | null;
  truck: string;
  truckTonCapacity: number | null;
  truckYardCapacity: number | null;
  driverId: string | null;
  driver: string;
  helperId: string | null;
  helper: string;
  color: string;
  shift: string;
  region: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DispatchTruck = {
  id: string;
  truckNumber: string;
  name: string;
  tons: number;
  yards: number;
  isActive: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type DispatchRouteTimingSummary = {
  routeId: string;
  orderCount: number;
  roundTripMinutes: number;
  missingCount: number;
};

export type DispatchEmployeeOption = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

export type DispatchAuditEvent = {
  id: string;
  action: string;
  actor: string;
  orderId: string | null;
  routeId: string | null;
  message: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  createdAt: string;
};

export type DispatchStopMetric = {
  orderId: string;
  routeId: string | null;
  routeCode: string | null;
  orderNumber: string | null;
  driverId: string | null;
  driverName: string | null;
  truck: string | null;
  customer: string | null;
  city: string | null;
  material: string | null;
  quantity: number | null;
  unit: string | null;
  stopSequence: number | null;
  googleRoundTripMinutes: number | null;
  googleRoundTripMiles: number | null;
  googleOneWayMinutes: number | null;
  enrouteAt: string | null;
  deliveredAt: string | null;
  actualDriveMinutes: number | null;
  actualRoundTripEstimateMinutes: number | null;
  correctionFactor: number | null;
};

export type DispatchDriverLocation = {
  routeId: string;
  routeCode: string | null;
  driverId: string | null;
  driverName: string | null;
  truck: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  capturedAt: string;
  updatedAt: string;
};

export type DispatchDriverScope = {
  id: string;
  email: string;
  role: {
    role: string;
    email: string;
    displayName: string;
  };
};

export type DispatchTimingAverage = {
  key: string;
  samples: number;
  averageCorrectionFactor: number | null;
  averageActualRoundTripMinutes: number | null;
  averageGoogleRoundTripMinutes: number | null;
};

export type DispatchTimingInsights = {
  sampleCount: number;
  latestSampleAt: string | null;
  globalAverage: DispatchTimingAverage | null;
  byDriver: Record<string, DispatchTimingAverage>;
  byDriverCity: Record<string, DispatchTimingAverage>;
};

export type DispatchTimingMatch = {
  source: string;
  samples: number;
  correctionFactor: number | null;
};

export type DispatchOperationalSettings = {
  shopAddress: string;
  defaultImportLimit: number;
  defaultImportSinceDays: number;
  calculateDistancesOnImport: boolean;
  distanceLimit: number;
  mapRefreshSeconds: number;
  driverLocationSeconds: number;
  driverReleaseDelayMinutes: number;
  quickDeliverEnabled: boolean;
  chimeEnabled: boolean;
  defaultDispatchDateMode: string;
  loaderAutoAdvance: boolean;
};

export type DispatchQuoteProduct = {
  sku: string;
  variantId: string;
  title: string;
  vendor: string;
  imageUrl: string;
  unitLabel: string;
  price: number;
  contractorTier1Price: number | null;
  contractorTier2Price: number | null;
};

export type DispatchQuoteAudience = "customer" | "contractor" | "custom";
export type DispatchQuoteTier = "tier1" | "tier2";

export type DispatchQuoteLineInput = {
  sku: string;
  quantity: number;
  customTitle?: string;
  customUnitPrice?: number | null;
};

export type DispatchQuoteInput = {
  audience: DispatchQuoteAudience;
  contractorTier: DispatchQuoteTier;
  companyName?: string;
  taxExempt?: boolean;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  billingAddress1?: string;
  billingAddress2?: string;
  billingCity?: string;
  billingProvince?: string;
  billingPostalCode?: string;
  billingCountry?: string;
  address1?: string;
  city?: string;
  notes?: string;
  customShippingLabel?: string;
  customShippingQuantity?: number | null;
  customShippingRate?: number | null;
  lines: DispatchQuoteLineInput[];
};

export type DispatchQuoteResult = {
  pricingLabel: string;
  productTotal: number;
  deliveryTotal: number;
  taxTotal: number;
  grandTotal: number;
  deliveryService: string;
  deliveryNotes: string;
  roundTripMinutes: number | null;
  roundTripMiles: number | null;
  lineItems: Array<{
    sku: string;
    title: string;
    vendor: string;
    quantity: number;
    unitLabel: string;
    unitPrice: number;
    lineTotal: number;
  }>;
  sourceBreakdown: Array<{
    vendor: string;
    quantity: number;
    items: string[];
  }>;
};

export type DispatchB2BCompany = {
  id: string;
  shopifyCompanyId: string;
  shopifyCompanyContactId: string;
  shopifyLocationId: string;
  companyName: string;
  contractorTier: DispatchQuoteTier;
  catalogTitles: string[];
  contactName: string;
  email: string;
  phone: string;
  billingAddress1: string;
  billingAddress2: string;
  billingCity: string;
  billingProvince: string;
  billingPostalCode: string;
  billingCountry: string;
  taxExempt: boolean;
  paymentTermsName: string;
  paymentTermsTemplateId: string;
  paymentTermsDueInDays: number | null;
  updatedAt: string;
};

export type DispatchSystemStatus = {
  supabaseConfigured: boolean;
  shopifyDomainConfigured: boolean;
  shopifyAccessTokenConfigured: boolean;
  shopifyApiCredentialsConfigured: boolean;
  shopifyImportReady: boolean;
  googleMapsServerConfigured: boolean;
  googleMapsBrowserConfigured: boolean;
  importSecretConfigured: boolean;
  distanceSecretConfigured: boolean;
  shopAddress: string;
  nodeVersion: string;
};

export type DispatchBoardState = {
  orders: DispatchOrder[];
  routes: DispatchRouteView[];
  unscheduled: DispatchOrder[];
};

export type DispatchRouteView = DispatchRoute & {
  orders: DispatchOrder[];
  deliveredOrders: DispatchOrder[];
};

export type DispatchMonitorRoute = DispatchRoute & {
  orders: DispatchOrder[];
  activeOrders: DispatchOrder[];
  totalStops: number;
  deliveredStops: number;
  enrouteStops: number;
  waitingStops: number;
  totalTravelMinutes: number;
  progressPercent: number;
  currentStop: DispatchOrder | null;
  nextLoad: DispatchOrder | null;
};

export type DispatchMonitorState = {
  orders: DispatchOrder[];
  routes: DispatchMonitorRoute[];
  unscheduled: DispatchOrder[];
  totals: {
    activeRoutes: number;
    activeStops: number;
    deliveredStops: number;
    enrouteStops: number;
    waitingStops: number;
    unscheduledStops: number;
    totalTravelMinutes: number;
  };
};

const DEFAULT_OPERATIONAL_SETTINGS: DispatchOperationalSettings = {
  shopAddress: DISPATCH_SHOP_ADDRESS,
  defaultImportLimit: 50,
  defaultImportSinceDays: 7,
  calculateDistancesOnImport: true,
  distanceLimit: 10,
  mapRefreshSeconds: 60,
  driverLocationSeconds: 60,
  driverReleaseDelayMinutes: 5,
  quickDeliverEnabled: false,
  chimeEnabled: true,
  defaultDispatchDateMode: "today-plus-undated",
  loaderAutoAdvance: true,
};

const DEFAULT_TRUCK_TON_CAPACITY = 22;
const DEFAULT_TRUCK_YARD_CAPACITY = 30;

export type DispatchBoardOptions = {
  dateKey?: string | null;
  includeUndated?: boolean;
};

export type DispatchOrderListOptions = {
  search?: string | null;
};

export type AssignOrderResult = {
  ok: boolean;
  message: string;
  updatedOrder: DispatchOrder;
  createdOrders: DispatchOrder[];
  createdCount: number;
};

export type CreateDispatchOrderInput = {
  orderNumber?: string;
  customer: string;
  contact?: string;
  address: string;
  city: string;
  material: string;
  quantity: string;
  unit: string;
  requestedWindow?: string;
  timePreference?: string;
  notes?: string;
};

export type CreateDispatchRouteInput = {
  code: string;
  truckId?: string | null;
  truck?: string;
  driver?: string;
  helper?: string;
  shift?: string;
  region?: string;
  color?: string;
};

export type UpdateDispatchOrderInput = {
  orderNumber: string;
  customer: string;
  contact?: string;
  address: string;
  city: string;
  material: string;
  quantity: string;
  unit: string;
  requestedWindow?: string;
  timePreference?: string;
  status: DispatchOrder["status"];
  notes?: string;
};

export type UpdateDispatchRouteInput = {
  code: string;
  truckId?: string | null;
  truck?: string;
  driverId?: string | null;
  driver?: string;
  helperId?: string | null;
  helper?: string;
  shift?: string;
  region?: string;
  color?: string;
  isActive: boolean;
};

export type DispatchTruckInput = {
  truckNumber: string;
  name?: string;
  tons?: string | number | null;
  yards?: string | number | null;
  isActive?: boolean;
  notes?: string;
};

export type ShopifyImportResult = {
  ok: boolean;
  mode?: ShopifyImportMode;
  imported: number;
  updated: number;
  skipped: number;
  distanceUpdated?: number;
  distanceSkipped?: number;
  message: string;
  details: string[];
};

export type ShopifyImportMode = "new" | "updates" | "sync";

export type DistanceCalculationResult = {
  ok: boolean;
  checked: number;
  updated: number;
  skipped: number;
  message: string;
  details: string[];
};

export type DispatchHealthStatus = "ok" | "degraded" | "unhealthy";

export type DispatchHealthCheck = {
  name: string;
  status: DispatchHealthStatus;
  latencyMs: number;
  message: string;
};

export type DispatchHealthResult = {
  ok: boolean;
  status: DispatchHealthStatus;
  checkedAt: string;
  service: string;
  checks: DispatchHealthCheck[];
};

type ShopifyOrderNode = {
  id: string;
  name: string;
  legacyResourceId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string;
  displayFinancialStatus?: string;
  note?: string | null;
  phone?: string | null;
  email?: string | null;
  customer?: {
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
    defaultAddress?: { phone?: string | null } | null;
  } | null;
  shippingAddress?: {
    name?: string | null;
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    provinceCode?: string | null;
    zip?: string | null;
  } | null;
  customAttributes?: Array<{ key?: string | null; value?: string | null }>;
  metafields?: {
    nodes?: Array<{ namespace?: string | null; key?: string | null; value?: string | null }>;
  };
  lineItems?: {
    nodes?: Array<{
      id?: string | null;
      title?: string | null;
      name?: string | null;
      sku?: string | null;
      vendor?: string | null;
      quantity?: number | null;
      customAttributes?: Array<{ key?: string | null; value?: string | null }>;
      variant?: {
        id?: string | null;
        title?: string | null;
        sku?: string | null;
        selectedOptions?: Array<{ name?: string | null; value?: string | null }>;
        product?: {
          handle?: string | null;
          title?: string | null;
          vendor?: string | null;
          unitLabel?: { value?: string | null } | null;
          legacyUnitLabel?: { value?: string | null } | null;
        } | null;
      } | null;
    }>;
  };
  shippingLines?: {
    nodes?: Array<{ title?: string | null }>;
  };
};

type ShopifyLineItem = NonNullable<NonNullable<ShopifyOrderNode["lineItems"]>["nodes"]>[number];

function formatSupabaseError(error: any) {
  return error?.message || error?.details || error?.hint || "Unknown Supabase error";
}

function isMissingTableError(error: any) {
  return error?.code === "42P01" || /does not exist|schema cache|could not find the table/i.test(error?.message || "");
}

export async function writeAuditLog(input: {
  action: string;
  actor?: string;
  orderId?: string | null;
  routeId?: string | null;
  message?: string;
  before?: unknown;
  after?: unknown;
}) {
  const { error } = await supabase.from("dispatch_audit_log").insert({
    action: input.action,
    actor: input.actor || "dispatch-v2",
    order_id: input.orderId || null,
    route_id: input.routeId || null,
    message: input.message || null,
    before_json: input.before ? JSON.stringify(input.before) : null,
    after_json: input.after ? JSON.stringify(input.after) : null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.warn("[dispatch-v2 audit skipped]", formatSupabaseError(error));
  }
}

function normalizeStatus(value: unknown): DispatchOrder["status"] {
  if (value === "scheduled" || value === "hold" || value === "delivered" || value === "cancelled") {
    return value;
  }
  return "new";
}

function normalizeDeliveryStatus(value: unknown): DispatchOrder["deliveryStatus"] {
  if (value === "en_route" || value === "delivered") return value;
  return "not_started";
}

function normalizeOrder(row: any): DispatchOrder {
  return {
    id: String(row.id),
    orderNumber: String(row.order_number || row.id),
    customer: String(row.customer || ""),
    contact: String(row.contact || ""),
    address: String(row.address || ""),
    city: String(row.city || ""),
    material: String(row.material || ""),
    quantity: String(row.quantity || ""),
    unit: String(row.unit || "Unit"),
    requestedWindow: String(row.requested_window || ""),
    timePreference: String(row.time_preference || "Anytime"),
    status: normalizeStatus(row.status),
    assignedRouteId: row.assigned_route_id || null,
    stopSequence:
      row.stop_sequence === null || row.stop_sequence === undefined
        ? null
        : Number(row.stop_sequence),
    deliveryStatus: normalizeDeliveryStatus(row.delivery_status),
    eta: row.eta || null,
    travelMinutes:
      row.travel_minutes === null || row.travel_minutes === undefined
        ? null
        : Number(row.travel_minutes),
    travelMiles:
      row.travel_miles === null || row.travel_miles === undefined
        ? null
        : Number(row.travel_miles),
    departedAt: row.departed_at || null,
    deliveredAt: row.delivered_at || null,
    proofName: row.proof_name || null,
    proofNotes: row.proof_notes || null,
    signatureData: row.signature_data || null,
    photoUrls: row.photo_urls || null,
    checklistJson: row.checklist_json || null,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function normalizeRoute(row: any): DispatchRoute {
  return {
    id: String(row.id),
    code: String(row.code || ""),
    truckId: row.truck_id || null,
    truck: String(row.truck || ""),
    truckTonCapacity: row.truck_tons === null || row.truck_tons === undefined ? null : Number(row.truck_tons),
    truckYardCapacity: row.truck_yards === null || row.truck_yards === undefined ? null : Number(row.truck_yards),
    driverId: row.driver_id || null,
    driver: String(row.driver || ""),
    helperId: row.helper_id || null,
    helper: String(row.helper || ""),
    color: String(row.color || "#38bdf8"),
    shift: String(row.shift || ""),
    region: String(row.region || ""),
    isActive: row.is_active !== false,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function normalizeTruck(row: any): DispatchTruck {
  return {
    id: String(row.id || ""),
    truckNumber: String(row.truck_number || ""),
    name: String(row.name || ""),
    tons: Number(row.tons || 0),
    yards: Number(row.yards || 0),
    isActive: row.is_active !== false,
    notes: String(row.notes || ""),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function truckMatchesRoute(route: DispatchRoute, truck: DispatchTruck) {
  const routeTruck = normalizedIdentity(route.truck);
  const truckNumber = normalizedIdentity(truck.truckNumber);
  const truckName = normalizedIdentity(truck.name);

  return Boolean(
    (route.truckId && route.truckId === truck.id) ||
      (routeTruck && routeTruck === truckNumber) ||
      (routeTruck && truckName && routeTruck === truckName),
  );
}

function enrichRoutesWithTruckCapacities(routes: DispatchRoute[], trucks: DispatchTruck[]) {
  return routes.map((route) => {
    const truck = trucks.find((entry) => truckMatchesRoute(route, entry));
    if (!truck) return route;

    return {
      ...route,
      truckId: route.truckId || truck.id,
      truck: route.truck || truck.truckNumber,
      truckTonCapacity: truck.tons || null,
      truckYardCapacity: truck.yards || null,
    };
  });
}

function normalizeEmployeeOption(row: any): DispatchEmployeeOption {
  const name =
    row.name ||
    row.display_name ||
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    row.email ||
    row.id;

  return {
    id: String(row.id || ""),
    name: String(name || ""),
    email: String(row.email || ""),
    role: String(row.role || row.position || row.employee_role || ""),
    isActive: row.is_active !== false && row.active !== false,
  };
}

function normalizeAuditEvent(row: any): DispatchAuditEvent {
  return {
    id: String(row.id),
    action: String(row.action || ""),
    actor: String(row.actor || ""),
    orderId: row.order_id || null,
    routeId: row.route_id || null,
    message: String(row.message || ""),
    beforeJson: row.before_json || null,
    afterJson: row.after_json || null,
    createdAt: row.created_at || "",
  };
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeStopMetric(row: any): DispatchStopMetric {
  return {
    orderId: String(row.order_id || ""),
    routeId: row.route_id || null,
    routeCode: row.route_code || null,
    orderNumber: row.order_number || null,
    driverId: row.driver_id || null,
    driverName: row.driver_name || null,
    truck: row.truck || null,
    customer: row.customer || null,
    city: row.city || null,
    material: row.material || null,
    quantity: numberOrNull(row.quantity),
    unit: row.unit || null,
    stopSequence: numberOrNull(row.stop_sequence),
    googleRoundTripMinutes: numberOrNull(row.google_round_trip_minutes),
    googleRoundTripMiles: numberOrNull(row.google_round_trip_miles),
    googleOneWayMinutes: numberOrNull(row.google_one_way_minutes),
    enrouteAt: row.enroute_at || null,
    deliveredAt: row.delivered_at || null,
    actualDriveMinutes: numberOrNull(row.actual_drive_minutes),
    actualRoundTripEstimateMinutes: numberOrNull(row.actual_round_trip_estimate_minutes),
    correctionFactor: numberOrNull(row.correction_factor),
  };
}

function normalizeDriverLocation(row: any): DispatchDriverLocation {
  return {
    routeId: String(row.route_id || ""),
    routeCode: row.route_code || null,
    driverId: row.driver_id || null,
    driverName: row.driver_name || null,
    truck: row.truck || null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy: numberOrNull(row.accuracy),
    heading: numberOrNull(row.heading),
    speed: numberOrNull(row.speed),
    capturedAt: row.captured_at || row.updated_at || "",
    updatedAt: row.updated_at || row.captured_at || "",
  };
}

function makeDispatchId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function makeManualOrderNumber() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `M-${month}${day}${hour}${minute}`;
}

function dateKeyFromValue(value?: string | null) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  const isoMatch = rawValue.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = rawValue.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, "0");
    const day = slashMatch[2].padStart(2, "0");
    return `${slashMatch[3]}-${month}-${day}`;
  }

  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) return "";
  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromTimestampInChicago(value?: string | null) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return dateKeyFromValue(rawValue);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

export function dispatchDateKeyFromValue(value?: string | null) {
  return dateKeyFromValue(value);
}

function todayDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

export function getDispatchTodayDateKey() {
  return todayDateKey();
}

async function runDispatchHealthCheck(name: string, check: () => Promise<string>, timeoutMs = 5000): Promise<DispatchHealthCheck> {
  const started = performance.now();
  try {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
    });
    const message = await Promise.race([check(), timeout]);
    const latencyMs = Math.round(performance.now() - started);
    return {
      name,
      latencyMs,
      status: latencyMs > 2500 ? "degraded" : "ok",
      message: latencyMs > 2500 ? `${message} Slow response.` : message,
    };
  } catch (error) {
    return {
      name,
      latencyMs: Math.round(performance.now() - started),
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Health check failed.",
    };
  }
}

async function checkSupabaseTable(table: string) {
  const { error } = await supabase.from(table).select("id").limit(1);
  if (error) throw new Error(formatSupabaseError(error));
  return `${table} reachable.`;
}

export async function loadDispatchHealthStatus(strict = false): Promise<DispatchHealthResult> {
  const checks = await Promise.all([
    runDispatchHealthCheck("dispatch_orders", () => checkSupabaseTable("dispatch_orders")),
    runDispatchHealthCheck("dispatch_routes", () => checkSupabaseTable("dispatch_routes")),
    runDispatchHealthCheck("dispatch_employees", () => checkSupabaseTable("dispatch_employees")),
    runDispatchHealthCheck("dispatch_driver_locations", () => checkSupabaseTable("dispatch_driver_locations")),
    runDispatchHealthCheck("photo_storage", async () => {
      const { error } = await supabase.storage.getBucket(DISPATCH_PHOTO_BUCKET);
      if (error) throw new Error(formatSupabaseError(error));
      return `Storage bucket ${DISPATCH_PHOTO_BUCKET} reachable.`;
    }),
  ]);

  const hasUnhealthy = checks.some((check) => check.status === "unhealthy");
  const hasDegraded = checks.some((check) => check.status === "degraded");
  const status: DispatchHealthStatus = hasUnhealthy || (strict && hasDegraded)
    ? "unhealthy"
    : hasDegraded
      ? "degraded"
      : "ok";

  return {
    ok: status !== "unhealthy",
    status,
    checkedAt: new Date().toISOString(),
    service: "dispatch-v2-sandbox",
    checks,
  };
}

function dispatchDateQueryPatterns(dateKey?: string | null) {
  if (!dateKey) return [];
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];

  const [, year, month, day] = match;
  const numericMonth = String(Number(month));
  const numericDay = String(Number(day));
  const monthName = new Date(`${dateKey}T12:00:00`).toLocaleString("en-US", {
    month: "long",
    timeZone: "America/Chicago",
  });
  const shortMonthName = new Date(`${dateKey}T12:00:00`).toLocaleString("en-US", {
    month: "short",
    timeZone: "America/Chicago",
  });

  return Array.from(new Set([
    `%${dateKey}%`,
    `%${month}/${day}/${year}%`,
    `%${numericMonth}/${numericDay}/${year}%`,
    `%${month}/${numericDay}/${year}%`,
    `%${numericMonth}/${day}/${year}%`,
    `%${monthName} ${numericDay}%${year}%`,
    `%${shortMonthName} ${numericDay}%${year}%`,
  ]));
}

function applyDispatchDatePrefilter(query: any, options: DispatchBoardOptions = {}) {
  const dateKey = options.dateKey || null;
  if (!dateKey) return query;

  const patterns = dispatchDateQueryPatterns(dateKey);
  if (!patterns.length) return query;

  const clauses = patterns.map((pattern) => `requested_window.ilike.${pattern}`);
  if (options.includeUndated !== false) {
    clauses.push("requested_window.is.null", "requested_window.eq.");
  }
  return query.or(clauses.join(","));
}

function filterOrdersByDispatchDate(
  orders: DispatchOrder[],
  options: DispatchBoardOptions = {},
) {
  const dateKey = options.dateKey || null;
  if (!dateKey) return orders;

  const includeUndated = options.includeUndated !== false;
  return orders.filter((order) => {
    const orderDateKey = dateKeyFromValue(order.requestedWindow);
    if (!orderDateKey) return includeUndated;
    return orderDateKey === dateKey;
  });
}

function sortStops(a: DispatchOrder, b: DispatchOrder) {
  return (
    Number(a.stopSequence || 9999) - Number(b.stopSequence || 9999) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function resequenceLocalOrdersForServer(orders: DispatchOrder[]) {
  return orders.map((order, index) => ({ ...order, stopSequence: index + 1 }));
}

function getOneWayMinutes(order: DispatchOrder) {
  const roundTripMinutes = Number(order.travelMinutes || 0);
  if (!Number.isFinite(roundTripMinutes) || roundTripMinutes <= 0) return 0;
  return Math.max(1, Math.round(roundTripMinutes / 2));
}

function formatEta(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

function getEnrouteEta(order: DispatchOrder, departedAtIso: string) {
  const oneWayMinutes = getOneWayMinutes(order);
  if (!oneWayMinutes) return null;
  const departedAt = new Date(departedAtIso);
  if (Number.isNaN(departedAt.getTime())) return null;
  departedAt.setMinutes(departedAt.getMinutes() + oneWayMinutes);
  return formatEta(departedAt);
}

function parseChecklist(value?: string | null) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function updateChecklistValue(order: DispatchOrder, updates: Record<string, unknown>) {
  return {
    ...parseChecklist(order.checklistJson),
    ...updates,
  };
}

function timingKey(...parts: Array<string | null | undefined>) {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function average(values: number[]) {
  return values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
    : null;
}

function buildTimingAverage(key: string, metrics: DispatchStopMetric[]): DispatchTimingAverage {
  const actualValues = metrics
    .map((metric) => metric.actualRoundTripEstimateMinutes)
    .filter((value): value is number => Boolean(value && value > 0));
  const googleValues = metrics
    .map((metric) => metric.googleRoundTripMinutes)
    .filter((value): value is number => Boolean(value && value > 0));
  const correctionValues = metrics
    .map((metric) => metric.correctionFactor)
    .filter((value): value is number => Boolean(value && value > 0));

  return {
    key,
    samples: metrics.length,
    averageCorrectionFactor: average(correctionValues),
    averageActualRoundTripMinutes: average(actualValues),
    averageGoogleRoundTripMinutes: average(googleValues),
  };
}

function buildTimingAverageMap(
  metrics: DispatchStopMetric[],
  keyBuilder: (metric: DispatchStopMetric) => string,
) {
  const groups = new Map<string, DispatchStopMetric[]>();
  for (const metric of metrics) {
    const key = keyBuilder(metric);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), metric]);
  }
  return Object.fromEntries(
    Array.from(groups.entries()).map(([key, group]) => [key, buildTimingAverage(key, group)]),
  ) as Record<string, DispatchTimingAverage>;
}

function parseDispatchQuantityNumber(value: string) {
  const parsed = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesBetween(startIso?: string | null, endIso?: string | null) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const minutes = (end.getTime() - start.getTime()) / 60000;
  return minutes > 0 ? Math.round(minutes * 10) / 10 : null;
}

export function normalizeShopDomain(domain: string) {
  return domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function redactedEnding(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "missing";
  return `...${trimmed.slice(-4)}`;
}

function cleanOrderNumber(name: string) {
  return String(name || "").replace(/^#/, "").trim();
}

function suffixForIndex(index: number, total: number) {
  if (total <= 1) return "";
  return String.fromCharCode(97 + index);
}

function compactPhone(value?: string | null) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstEmailFromContact(value?: string | null) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function fullOrderAddress(order: DispatchOrder) {
  return [order.address, order.city].filter(Boolean).join(", ").trim();
}

function googleMapsLinkForOrder(order: DispatchOrder) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullOrderAddress(order))}`;
}

function googleMapsLinkForGps(value?: string | null) {
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return match ? `https://www.google.com/maps/search/?api=1&query=${match[1]},${match[2]}` : "";
}

function parseImageDataUrl(value?: string | null) {
  const match = String(value || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1] || "image/jpeg";
  const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const base64 = match[2] || "";
  return {
    mimeType,
    extension,
    base64,
    buffer: Buffer.from(base64, "base64"),
  };
}

function isMissingStorageBucketError(error: any) {
  return /bucket not found|not found/i.test(`${error?.message || ""} ${error?.error || ""}`);
}

async function ensureDispatchPhotoBucket() {
  if (dispatchPhotoBucketReady) return dispatchPhotoBucketReady;

  dispatchPhotoBucketReady = (async () => {
    const bucketOptions = {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"],
    };

    const { error: getError } = await supabase.storage.getBucket(DISPATCH_PHOTO_BUCKET);
    if (!getError) return;

    if (!isMissingStorageBucketError(getError)) {
      throw new Error(
        `Unable to verify Supabase Storage bucket "${DISPATCH_PHOTO_BUCKET}": ${formatSupabaseError(getError)}`,
      );
    }

    const { error: createError } = await supabase.storage.createBucket(DISPATCH_PHOTO_BUCKET, bucketOptions);
    if (createError && !/already exists|duplicate/i.test(formatSupabaseError(createError))) {
      throw new Error(
        `Unable to create Supabase Storage bucket "${DISPATCH_PHOTO_BUCKET}": ${formatSupabaseError(createError)}`,
      );
    }

    const { error: updateError } = await supabase.storage.updateBucket(DISPATCH_PHOTO_BUCKET, bucketOptions);
    if (updateError) {
      console.warn("[dispatch-v2 photo bucket update skipped]", formatSupabaseError(updateError));
    }
  })().catch((error) => {
    dispatchPhotoBucketReady = null;
    throw error;
  });

  return dispatchPhotoBucketReady;
}

function dataUrlToEmailAttachment(value?: string | null) {
  const image = parseImageDataUrl(value);
  if (!image) return null;

  return {
    filename: `delivery-proof.${image.extension}`,
    content: image.base64,
  };
}

async function uploadDispatchPhoto(value: string, folder: string, filenameHint = "photo") {
  const existingUrl = String(value || "").trim();
  if (/^https?:\/\//i.test(existingUrl)) {
    return { url: existingUrl, path: "", mimeType: "", size: 0 };
  }

  const image = parseImageDataUrl(value);
  if (!image) throw new Error("Photo upload requires an image file.");

  const safeHint = filenameHint
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "photo";
  const path = `${folder}/${Date.now()}-${randomUUID()}-${safeHint}.${image.extension}`;
  const uploadOptions = {
    contentType: image.mimeType,
    cacheControl: "31536000",
    upsert: false,
  };
  let { error } = await supabase.storage.from(DISPATCH_PHOTO_BUCKET).upload(path, image.buffer, uploadOptions);

  if (error && isMissingStorageBucketError(error)) {
    await ensureDispatchPhotoBucket();
    ({ error } = await supabase.storage.from(DISPATCH_PHOTO_BUCKET).upload(path, image.buffer, uploadOptions));
  }

  if (error) {
    throw new Error(
      `Unable to upload dispatch photo to Supabase Storage bucket "${DISPATCH_PHOTO_BUCKET}": ${formatSupabaseError(error)}`,
    );
  }

  const { data } = supabase.storage.from(DISPATCH_PHOTO_BUCKET).getPublicUrl(path);
  return {
    url: data.publicUrl,
    path,
    mimeType: image.mimeType,
    size: image.buffer.byteLength,
  };
}

function orderDisplayNumber(order: DispatchOrder) {
  return order.orderNumber ? `#${order.orderNumber}` : order.id;
}

function formatDeliveredAt(order: DispatchOrder) {
  const date = new Date(order.deliveredAt || Date.now());
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  });
}

function deliveryPhotoList(value?: string | null) {
  const proof = String(value || "").trim();
  if (!proof) return [];
  if (/^data:image\//i.test(proof) || /^https?:\/\/.+/i.test(proof)) return [proof];

  try {
    const parsed = JSON.parse(proof);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => String(entry || "").trim())
        .filter((entry) => /^data:image\//i.test(entry) || /^https?:\/\/.+/i.test(entry));
    }
  } catch {
    // Non-JSON proof strings are handled below.
  }

  return proof
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^data:image\//i.test(entry) || /^https?:\/\/.+/i.test(entry));
}

function imageProofSource(value?: string | null) {
  const photos = deliveryPhotoList(value);
  return photos.at(-1) || "";
}

function gpsProof(value?: string | null) {
  const proof = String(value || "").trim();
  const match = proof.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return {
      text: proof || "Not captured",
      mapsUrl: "",
    };
  }

  const latitude = match[1];
  const longitude = match[2];
  return {
    text: proof,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`,
  };
}

function quantityColumns(order: DispatchOrder) {
  const unit = order.unit.toLowerCase();
  return {
    tons: /tons?/.test(unit) ? order.quantity : "",
    yards: /yards?/.test(unit) ? order.quantity : "",
    bags: /bags?/.test(unit) ? order.quantity : "",
    gallons: /gallons?/.test(unit) ? order.quantity : "",
  };
}

function deliverySectionTitle(title: string) {
  return `<div style="margin-top:24px;background:#2368aa;color:#9ad20f;text-align:center;font-weight:900;padding:8px 10px;">${escapeHtml(title)}</div>`;
}

function deliveryFieldCell(label: string, value: string) {
  return `<td style="width:50%;border:2px solid #ffffff;padding:8px 10px;vertical-align:top;">
    <div style="color:#9ad20f;font-size:12px;font-weight:900;">${escapeHtml(label)}</div>
    <div style="color:#ffffff;font-size:14px;line-height:1.45;margin-top:4px;">${escapeHtml(value || " ")}</div>
  </td>`;
}

function deliveryFieldCellHtml(label: string, htmlValue: string) {
  return `<td style="width:50%;border:2px solid #ffffff;padding:8px 10px;vertical-align:top;">
    <div style="color:#9ad20f;font-size:12px;font-weight:900;">${escapeHtml(label)}</div>
    <div style="color:#ffffff;font-size:14px;line-height:1.45;margin-top:4px;">${htmlValue || " "}</div>
  </td>`;
}

function deliveryGpsHtml(value: string, mapsUrl: string) {
  const escapedValue = escapeHtml(value || "Not captured");
  if (!mapsUrl) return escapedValue;

  return `${escapedValue}<br /><a href="${escapeHtml(mapsUrl)}" style="color:#9ad20f;font-weight:900;">Open GPS location in Google Maps</a>`;
}

function deliveryPhotoCell(src: string) {
  return `<td style="width:50%;border:2px solid #ffffff;padding:8px 10px;vertical-align:top;">
    <div style="color:#9ad20f;font-size:12px;font-weight:900;">Picture of Delivered Order</div>
    <img src="${escapeHtml(src)}" alt="Picture of delivered order" style="display:block;width:100%;max-width:320px;height:auto;margin-top:8px;border:1px solid #9ad20f;border-radius:6px;" />
  </td>`;
}

function deliveryTableHeader(label: string) {
  return `<th style="background:#2368aa;color:#9ad20f;border:1px solid #ffffff;padding:8px 6px;font-size:12px;line-height:1.2;text-align:center;">${escapeHtml(label)}</th>`;
}

function deliveryTableCell(value: string) {
  return `<td style="background:#ffffff;color:#000000;border:1px solid #777;padding:8px 6px;font-size:13px;text-align:center;">${escapeHtml(value || " ")}</td>`;
}

function buildDeliveryConfirmationEmail(order: DispatchOrder, route: DispatchRoute | null, input: {
  proofName: string;
  proofNotes: string;
  gpsLocation: string;
  photoUrls: string;
}) {
  const quantity = quantityColumns(order);
  const orderNumber = orderDisplayNumber(order);
  const deliveredAt = formatDeliveredAt(order);
  const driverName = input.proofName || route?.driver || order.proofName || "";
  const photoProof = input.photoUrls || "Not captured";
  const photoProofSource = imageProofSource(input.photoUrls);
  const gps = gpsProof(input.gpsLocation);
  const logoUrl = `${PUBLIC_APP_URL}/email-green-hills-logo.png`;
  const address = fullOrderAddress(order);
  const subject = `Green Hills Supply delivery confirmation ${orderNumber}`;
  const text = [
    "Green Hills Supply Delivery Confirmation",
    "",
    `Order: ${orderNumber}`,
    `Delivered: ${deliveredAt}`,
    "",
    "Driver and Truck Information",
    `Truck: ${route?.truck || ""}`,
    `Driver: ${driverName}`,
    `Route: ${route?.code || ""}`,
    "",
    "Customer Information",
    `Customer: ${order.customer}`,
    `Address: ${address}`,
    `Contact: ${order.contact || ""}`,
    "",
    `Material Type: ${order.unit}`,
    `Product Ordered: ${order.material}`,
    `Quantity: ${order.quantity} ${order.unit}`,
    "",
    `Delivery Notes: ${input.proofNotes || ""}`,
    `Photo Proof: ${photoProof}`,
    `GPS Proof: ${gps.text}${gps.mapsUrl ? ` (${gps.mapsUrl})` : ""}`,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#000000;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <div style="max-width:760px;margin:0 auto;background:#000000;padding:28px 24px 36px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <td style="width:170px;border:2px solid #ffffff;padding:8px;text-align:center;vertical-align:middle;background:#ffffff;">
          <img src="${escapeHtml(logoUrl)}" alt="Green Hills Supply" width="150" style="display:block;width:150px;max-width:150px;height:auto;margin:0 auto;border:0;" />
        </td>
        <td style="padding-left:16px;vertical-align:middle;">
          <div style="border:2px solid #ffffff;padding:12px 14px;font-size:20px;font-weight:900;color:#ffffff;">
            Delivery Confirmation ${escapeHtml(orderNumber)}
          </div>
        </td>
      </tr>
      </table>

      ${deliverySectionTitle("Driver and Truck Information")}
      <table role="presentation" width="100%" cellspacing="12" cellpadding="0" style="border-collapse:separate;margin-top:10px;">
        <tr>
          ${deliveryFieldCell("Truck Number", route?.truck || "")}
          ${deliveryFieldCell("Driver Name", driverName)}
        </tr>
        <tr>
          ${deliveryFieldCell("Order Number", orderNumber)}
          ${deliveryFieldCell("Delivered Date / Time", deliveredAt)}
        </tr>
      </table>

      ${deliverySectionTitle("Customer Information")}
      <table role="presentation" width="100%" cellspacing="12" cellpadding="0" style="border-collapse:separate;margin-top:10px;">
        <tr>
          ${deliveryFieldCell("Customer Name", order.customer)}
          ${deliveryFieldCell("Customer Email / Contact", order.contact || "")}
        </tr>
        <tr>
          ${deliveryFieldCell("Address", address)}
          ${deliveryFieldCell("Delivery Notes", input.proofNotes || "")}
        </tr>
      </table>

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:22px;">
        <tr>
          ${deliveryTableHeader("Material Type")}
          ${deliveryTableHeader("Product Ordered")}
          ${deliveryTableHeader("Total Tonnage Delivered")}
          ${deliveryTableHeader("Total Yardage Delivered")}
          ${deliveryTableHeader("Total Bags Delivered")}
          ${deliveryTableHeader("Total Gallons Delivered")}
        </tr>
        <tr>
          ${deliveryTableCell(order.unit)}
          ${deliveryTableCell(order.material)}
          ${deliveryTableCell(quantity.tons)}
          ${deliveryTableCell(quantity.yards)}
          ${deliveryTableCell(quantity.bags)}
          ${deliveryTableCell(quantity.gallons)}
        </tr>
      </table>

      ${deliverySectionTitle("Delivery Proof")}
      <table role="presentation" width="100%" cellspacing="12" cellpadding="0" style="border-collapse:separate;margin-top:10px;">
        <tr>
          ${deliveryFieldCell("Driver Signature", driverName)}
          ${deliveryFieldCellHtml("GPS Location Verification", deliveryGpsHtml(gps.text, gps.mapsUrl))}
        </tr>
        <tr>
          ${photoProofSource ? deliveryPhotoCell(photoProofSource) : deliveryFieldCell("Picture of Delivered Order", photoProof)}
          ${deliveryFieldCell("Driver Notes Upon Delivery", input.proofNotes || "")}
        </tr>
      </table>

      <p style="margin:28px 0 0;color:#ffffff;font-size:14px;line-height:1.6;">
        Thank you for your order. If you have any questions about your delivery, please reply to this email or contact Green Hills Supply.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

async function sendDeliveryConfirmationEmail(order: DispatchOrder, route: DispatchRoute | null, input: {
  proofName: string;
  proofNotes: string;
  gpsLocation: string;
  photoUrls: string;
}) {
  const recipient = firstEmailFromContact(order.contact);
  if (!recipient) {
    return { sent: false, message: "No customer email found on the order." };
  }
  if (!RESEND_API_KEY || !DISPATCH_EMAIL_FROM) {
    return { sent: false, message: "Delivery email skipped because RESEND_API_KEY or DISPATCH_EMAIL_FROM is not configured." };
  }

  const attachment = dataUrlToEmailAttachment(input.photoUrls);
  const email = buildDeliveryConfirmationEmail(order, route, input);
  const payload: Record<string, unknown> = {
    from: DISPATCH_EMAIL_FROM,
    to: [recipient],
    subject: email.subject,
    html: email.html,
    text: email.text,
  };

  if (DISPATCH_EMAIL_REPLY_TO) payload.reply_to = DISPATCH_EMAIL_REPLY_TO;
  if (attachment) payload.attachments = [attachment];

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Delivery email failed (${response.status}): ${responseText}`);
  }

  return { sent: true, message: `Delivery confirmation sent to ${recipient}.` };
}

function findShopifyField(
  order: ShopifyOrderNode,
  patterns: RegExp[],
) {
  const customMatch = (order.customAttributes || []).find((attribute) =>
    patterns.some((pattern) => pattern.test(`${attribute.key || ""} ${attribute.value || ""}`)),
  );
  if (customMatch?.value) return String(customMatch.value).trim();

  const metafieldMatch = (order.metafields?.nodes || []).find((metafield) =>
    patterns.some((pattern) => pattern.test(`${metafield.namespace || ""} ${metafield.key || ""}`)),
  );
  return String(metafieldMatch?.value || "").trim();
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function collectShopifyOrderNotes(order: ShopifyOrderNode) {
  const notePatterns = [
    /order.*note/i,
    /delivery.*note/i,
    /customer.*note/i,
    /drop.*off/i,
    /dropoff/i,
    /where.*drop/i,
    /instructions?/i,
    /delivery.*instructions?/i,
    /special.*instructions?/i,
  ];
  const customNotes = (order.customAttributes || [])
    .filter((attribute) => notePatterns.some((pattern) => pattern.test(`${attribute.key || ""} ${attribute.value || ""}`)))
    .map((attribute) => attribute.value || "");
  const metafieldNotes = (order.metafields?.nodes || [])
    .filter((metafield) => notePatterns.some((pattern) => pattern.test(`${metafield.namespace || ""} ${metafield.key || ""}`)))
    .map((metafield) => metafield.value || "");

  return uniqueStrings([...metafieldNotes, ...customNotes]);
}

function normalizeDispatchUnitLabel(value?: string | null) {
  const normalized = String(value || "")
    .trim()
    .replace(/^per\s+/i, "")
    .replace(/^\/\s*/, "")
    .toLowerCase();

  if (!normalized) return "";
  if (/tons?/.test(normalized)) return "Ton";
  if (/yards?/.test(normalized)) return "Yard";
  if (/bags?/.test(normalized)) return "Bag";
  if (/gallons?/.test(normalized)) return "Gallon";
  if (/units?/.test(normalized)) return "Unit";
  return "";
}

function inferUnitLabel(text: string) {
  const value = text.toLowerCase();
  const explicitUnit = normalizeDispatchUnitLabel(value);
  if (explicitUnit) return explicitUnit;
  if (value.includes("mulch") || value.includes("topsoil") || value.includes("compost") || value.includes("yard")) {
    return "Yard";
  }
  if (value.includes("stone") || value.includes("gravel") || value.includes("sand") || value.includes("base") || value.includes("ton")) {
    return "Ton";
  }
  return "Unit";
}

type ProductSourceMatch = {
  sku: string;
  productTitle: string;
  unitLabel: string;
};

type ResolvedShopifyMaterial = {
  material: string;
  fallbackMaterial: string;
  sourceMatch: ProductSourceMatch | null;
};

function skuLookupValues(...values: Array<string | null | undefined>) {
  const normalized = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

async function lookupProductSourceMatch(input: { sku: string; title: string }): Promise<ProductSourceMatch | null> {
  const sku = input.sku.trim();
  const title = input.title.trim();
  if (!sku && !title) return null;

  try {
    let data: any = null;
    let error: any = null;

    const skuValues = skuLookupValues(sku);
    for (const skuValue of skuValues) {
      const result = await supabase
        .from("product_source_map")
        .select("sku, product_title, unit_label")
        .eq("sku", skuValue)
        .maybeSingle();
      if (result.error) {
        error = result.error;
        break;
      }
      if (result.data) {
        data = result.data;
        break;
      }
    }

    if (!data && !error && title) {
      const result = await supabase
        .from("product_source_map")
        .select("sku, product_title, unit_label")
        .ilike("product_title", `%${title}%`)
        .limit(1)
        .maybeSingle();
      data = result.data;
      error = result.error;
    }

    if (error) {
      if (!isMissingTableError(error) && error.code !== "42703") {
        console.warn("[dispatch-v2 product source unit lookup skipped]", formatSupabaseError(error));
      }
      return null;
    }

    if (!data) return null;
    return {
      sku: String(data.sku || ""),
      productTitle: String(data.product_title || ""),
      unitLabel: normalizeDispatchUnitLabel(data.unit_label || ""),
    };
  } catch (error) {
    console.warn("[dispatch-v2 product source unit lookup failed]", error);
    return null;
  }
}

async function lookupProductSourceUnitLabel(input: { sku: string; title: string }) {
  const match = await lookupProductSourceMatch(input);
  return match?.unitLabel || "";
}

async function resolveShopifyUnitLabel(lineItem: ShopifyLineItem, material: string) {
  const sku = lineItem.sku || lineItem.variant?.sku || "";
  const metafieldUnit = normalizeDispatchUnitLabel(
    lineItem.variant?.product?.unitLabel?.value ||
      lineItem.variant?.product?.legacyUnitLabel?.value ||
      "",
  );
  if (metafieldUnit) return metafieldUnit;

  const mappedUnit = await lookupProductSourceUnitLabel({ sku, title: material || lineItem.name || "" });
  if (mappedUnit) return mappedUnit;

  return inferUnitLabel(`${lineItem.name || ""} ${material} ${sku}`);
}

function cleanShopifyMaterialName(value?: string | null) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+Default Title$/i, "")
    .trim();
}

function fullShopifyMaterialName(lineItem: ShopifyLineItem) {
  const lineName = cleanShopifyMaterialName(lineItem.name || lineItem.title);
  if (lineName && !/^default title$/i.test(lineName)) return lineName;

  const productTitle = cleanShopifyMaterialName(lineItem.variant?.product?.title);
  const variantTitle = cleanShopifyMaterialName(lineItem.variant?.title);
  if (
    productTitle &&
    variantTitle &&
    !/^default title$/i.test(variantTitle) &&
    !productTitle.toLowerCase().includes(variantTitle.toLowerCase())
  ) {
    return `${productTitle} - ${variantTitle}`;
  }

  return productTitle || lineName || "Shopify product";
}

function meaningfulShopifyVariantTitle(lineItem: ShopifyLineItem) {
  const variantTitle = cleanShopifyMaterialName(lineItem.variant?.title);
  if (!variantTitle || /^default title$/i.test(variantTitle)) return "";
  return variantTitle;
}

function meaningfulShopifyOptionValues(lineItem: ShopifyLineItem) {
  const values: string[] = [];
  for (const option of lineItem.variant?.selectedOptions || []) {
    const name = cleanShopifyMaterialName(option.name);
    const value = cleanShopifyMaterialName(option.value);
    if (!value || /^default title$/i.test(value)) continue;
    if (/^title$/i.test(name) && /^default$/i.test(value)) continue;
    values.push(value);
  }

  for (const attribute of lineItem.customAttributes || []) {
    const key = cleanShopifyMaterialName(attribute.key);
    const value = cleanShopifyMaterialName(attribute.value);
    if (!value || /^default title$/i.test(value)) continue;
    if (/^(sku|_?shopify|_?bundle|_?source|delivery|shipping)$/i.test(key)) continue;
    if (/^https?:\/\//i.test(value)) continue;
    values.push(value);
  }

  return Array.from(new Set(values));
}

function appendVariantTitleIfMissing(productTitle: string, variantTitle: string) {
  const title = cleanShopifyMaterialName(productTitle);
  const variant = cleanShopifyMaterialName(variantTitle);
  if (!title || !variant) return title || variant;

  const normalizedTitle = title.toLowerCase();
  const normalizedVariant = variant.toLowerCase();
  if (normalizedTitle.includes(normalizedVariant)) return title;

  return `${title} - ${variant}`;
}

function appendDescriptorsIfMissing(productTitle: string, descriptors: string[]) {
  return descriptors.reduce((title, descriptor) => appendVariantTitleIfMissing(title, descriptor), productTitle);
}

function normalizeProductNameForCompare(value: string) {
  return cleanShopifyMaterialName(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shopifyLineItemDescriptor(lineItem: ShopifyLineItem, baseTitle: string) {
  const base = normalizeProductNameForCompare(baseTitle);
  const candidates = [
    lineItem.name,
    lineItem.title,
    lineItem.variant?.product?.title,
    lineItem.variant?.title,
    ...meaningfulShopifyOptionValues(lineItem),
  ]
    .map(cleanShopifyMaterialName)
    .filter(Boolean);

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeProductNameForCompare(candidate);
    if (!base || normalizedCandidate === base || !normalizedCandidate.includes(base)) continue;

    const escapedBase = baseTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const suffix = cleanShopifyMaterialName(
      candidate
        .replace(new RegExp(`^\\s*${escapedBase}\\s*[-–—:]?\\s*`, "i"), "")
        .replace(new RegExp(`\\s*[-–—:]?\\s*${escapedBase}\\s*$`, "i"), ""),
    );
    if (suffix && normalizeProductNameForCompare(suffix) !== base) return suffix;
  }

  const sizeMatch = candidates
    .join(" ")
    .match(/\b(extra\s+large|large|medium|small)\b/i);
  return sizeMatch?.[1] || "";
}

async function resolveShopifyMaterialName(lineItem: ShopifyLineItem): Promise<ResolvedShopifyMaterial> {
  const fallbackMaterial = fullShopifyMaterialName(lineItem);
  const sku = lineItem.sku || lineItem.variant?.sku || "";
  const sourceMatch = await lookupProductSourceMatch({ sku, title: fallbackMaterial });
  if (sourceMatch?.productTitle) {
    return {
      material: sourceMatch.productTitle,
      fallbackMaterial,
      sourceMatch,
    };
  }
  return { material: fallbackMaterial, fallbackMaterial, sourceMatch: null };
}

function buildShopifyChecklist(
  order: ShopifyOrderNode,
  lineItem: ShopifyLineItem,
  orderNotes: string[] = [],
  importKey = "",
  resolvedMaterial?: ResolvedShopifyMaterial,
) {
  return JSON.stringify({
    shopifyOrderId: order.id,
    shopifyOrderName: order.name,
    shopifyLegacyResourceId: order.legacyResourceId || "",
    shopifyImportKey: importKey,
    shopifyLineItemId: lineItem.id || "",
    shopifyVariantId: lineItem.variant?.id || "",
    shopifyUpdatedAt: order.updatedAt || null,
    sku: lineItem.sku || lineItem.variant?.sku || "",
    vendor: lineItem.vendor || lineItem.variant?.product?.vendor || "",
    shopifyLineItemName: lineItem.name || "",
    shopifyLineItemTitle: lineItem.title || "",
    shopifyVariantTitle: lineItem.variant?.title || "",
    shopifySelectedOptions: lineItem.variant?.selectedOptions || [],
    shopifyLineItemAttributes: lineItem.customAttributes || [],
    shopifyProductTitle: lineItem.variant?.product?.title || "",
    shopifyProductHandle: lineItem.variant?.product?.handle || "",
    shopifyFallbackMaterial: resolvedMaterial?.fallbackMaterial || fullShopifyMaterialName(lineItem),
    productSourceSku: resolvedMaterial?.sourceMatch?.sku || "",
    productSourceTitle: resolvedMaterial?.sourceMatch?.productTitle || "",
    dispatchMaterial: resolvedMaterial?.material || "",
    shopifyOrderNotes: orderNotes,
    importedFrom: "shopify",
  });
}

async function buildShopifyDispatchRow(order: ShopifyOrderNode, lineItem: ShopifyLineItem, ticketNumber: string, importKey = "") {
  const shipping = order.shippingAddress;
  const customerName = shipping?.name || order.customer?.displayName || "Shopify customer";
  const email = order.email || order.customer?.email || "";
  const phone =
    shipping?.phone ||
    order.phone ||
    order.customer?.phone ||
    order.customer?.defaultAddress?.phone ||
    "";
  const address = [shipping?.address1, shipping?.address2].filter(Boolean).join(", ");
  const city = [shipping?.city, shipping?.provinceCode, shipping?.zip].filter(Boolean).join(", ");
  const preferredDelivery = findShopifyField(order, [/preferred.*delivery/i, /delivery.*date/i, /pickup.*preference/i]);
  const resolvedMaterial = await resolveShopifyMaterialName(lineItem);
  const material = resolvedMaterial.material;
  const sku = lineItem.sku || lineItem.variant?.sku || "";
  const orderNotes = collectShopifyOrderNotes(order);
  const contact = [compactPhone(phone), email].filter(Boolean).join(" / ") || "No contact on Shopify";
  const unit = await resolveShopifyUnitLabel(lineItem, material);
  const now = new Date().toISOString();

  return {
    id: makeDispatchId("S"),
    order_number: ticketNumber,
    // The current dispatch schema only allows email/manual sources.
    // Shopify-origin identity is stored in checklist_json.
    source: "email",
    customer: customerName,
    contact,
    address,
    city,
    material,
    quantity: String(lineItem.quantity || 1),
    unit,
    requested_window: preferredDelivery || "",
    time_preference: "Anytime",
    status: "new",
    delivery_status: "not_started",
    proof_notes: orderNotes.join("\n") || "",
    checklist_json: buildShopifyChecklist(order, lineItem, orderNotes, importKey, resolvedMaterial),
    created_at: now,
    updated_at: now,
  };
}

function durationToSeconds(value?: string | null) {
  const match = String(value || "").match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Number(match[1]) : 0;
}

function milesFromMeters(value: number) {
  return Math.round((value / 1609.344) * 10) / 10;
}

function fullDeliveryAddress(order: DispatchOrder) {
  return [order.address, order.city].filter(Boolean).join(", ").trim();
}

async function computeOneWayRouteWithRoutesApi(originAddress: string, destinationAddress: string) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("Missing GOOGLE_MAPS_API_KEY.");
  }

  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { address: originAddress },
      destination: { address: destinationAddress },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      units: "IMPERIAL",
    }),
  });

  const body = await response.json() as {
    routes?: Array<{ duration?: string; distanceMeters?: number }>;
    error?: { message?: string; status?: string };
  };

  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `Google Routes failed with HTTP ${response.status}.`);
  }

  const route = body.routes?.[0];
  if (!route) {
    throw new Error("Google Routes returned no route.");
  }

  return {
    seconds: durationToSeconds(route.duration),
    meters: Number(route.distanceMeters || 0),
  };
}

async function computeOneWayRouteWithDirectionsApi(originAddress: string, destinationAddress: string) {
  const params = new URLSearchParams({
    origin: originAddress,
    destination: destinationAddress,
    mode: "driving",
    units: "imperial",
    departure_time: "now",
    traffic_model: "best_guess",
    key: GOOGLE_MAPS_API_KEY,
  });
  const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
  const body = await response.json() as {
    status?: string;
    error_message?: string;
    routes?: Array<{
      legs?: Array<{
        duration?: { value?: number };
        duration_in_traffic?: { value?: number };
        distance?: { value?: number };
      }>;
    }>;
  };

  if (!response.ok || body.status !== "OK") {
    throw new Error(body.error_message || `Google Directions failed with status ${body.status || response.status}.`);
  }

  const leg = body.routes?.[0]?.legs?.[0];
  if (!leg) {
    throw new Error("Google Directions returned no route.");
  }

  return {
    seconds: Number(leg.duration_in_traffic?.value || leg.duration?.value || 0),
    meters: Number(leg.distance?.value || 0),
  };
}

async function computeOneWayRoute(originAddress: string, destinationAddress: string) {
  try {
    return await computeOneWayRouteWithRoutesApi(originAddress, destinationAddress);
  } catch (routesError) {
    try {
      return await computeOneWayRouteWithDirectionsApi(originAddress, destinationAddress);
    } catch (directionsError) {
      const routesMessage = routesError instanceof Error ? routesError.message : "Routes API failed.";
      const directionsMessage = directionsError instanceof Error ? directionsError.message : "Directions API failed.";
      throw new Error(
        `Google route timing failed. Routes API: ${routesMessage} Directions fallback: ${directionsMessage}`,
      );
    }
  }
}

async function computeRoundTripRoute(destinationAddress: string) {
  const outbound = await computeOneWayRoute(DISPATCH_SHOP_ADDRESS, destinationAddress);
  const inbound = await computeOneWayRoute(destinationAddress, DISPATCH_SHOP_ADDRESS);
  const seconds = outbound.seconds + inbound.seconds;
  const meters = outbound.meters + inbound.meters;

  return {
    minutes: Math.max(1, Math.ceil(seconds / 60)),
    miles: milesFromMeters(meters),
  };
}

function isMissingStopMetricsTable(error: any) {
  return error?.code === "42P01" || /does not exist|schema cache/i.test(error?.message || "");
}

function emptyTimingInsights(): DispatchTimingInsights {
  return {
    sampleCount: 0,
    latestSampleAt: null,
    globalAverage: null,
    byDriver: {},
    byDriverCity: {},
  };
}

function cacheTimingInsights(limit: number, insights: DispatchTimingInsights) {
  cachedDispatchTimingInsights = {
    limit,
    insights,
    expiresAt: Date.now() + TIMING_INSIGHTS_CACHE_MS,
  };
  return insights;
}

function clearTimingInsightsCache() {
  cachedDispatchTimingInsights = null;
}

export async function getDispatchTimingInsights(limit = 1000): Promise<DispatchTimingInsights> {
  if (
    cachedDispatchTimingInsights &&
    cachedDispatchTimingInsights.limit >= limit &&
    cachedDispatchTimingInsights.expiresAt > Date.now()
  ) {
    return cachedDispatchTimingInsights.insights;
  }

  const { data, error } = await supabase
    .from(STOP_METRICS_TABLE)
    .select("*")
    .not("delivered_at", "is", null)
    .order("delivered_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingStopMetricsTable(error)) {
      return cacheTimingInsights(limit, emptyTimingInsights());
    }
    throw new Error(formatSupabaseError(error));
  }

  const metrics = (data || [])
    .map(normalizeStopMetric)
    .filter(
      (metric) =>
        Boolean(metric.deliveredAt) &&
        Number(metric.actualRoundTripEstimateMinutes || 0) > 0 &&
        Number(metric.correctionFactor || 0) > 0,
    );

  return cacheTimingInsights(limit, {
    sampleCount: metrics.length,
    latestSampleAt: metrics[0]?.deliveredAt || null,
    globalAverage: metrics.length ? buildTimingAverage("all", metrics) : null,
    byDriver: buildTimingAverageMap(metrics, (metric) => timingKey(metric.driverName || metric.driverId)),
    byDriverCity: buildTimingAverageMap(metrics, (metric) => timingKey(metric.driverName || metric.driverId, metric.city)),
  });
}

export async function recordDispatchStopMetric(input: {
  order: DispatchOrder;
  route?: DispatchRoute | null;
  event: "enroute" | "delivered";
  happenedAt?: string | null;
}) {
  const happenedAt = input.happenedAt || new Date().toISOString();
  const route = input.route || null;
  const order = input.order;
  const googleRoundTripMinutes = Number(order.travelMinutes || 0) || null;
  const googleRoundTripMiles = Number(order.travelMiles || 0) || null;
  const googleOneWayMinutes = googleRoundTripMinutes
    ? Math.round((googleRoundTripMinutes / 2) * 10) / 10
    : null;
  const enrouteAt = input.event === "enroute" ? happenedAt : order.departedAt || happenedAt;
  const deliveredAt = input.event === "delivered" ? happenedAt : order.deliveredAt || null;
  const actualDriveMinutes = minutesBetween(enrouteAt, deliveredAt);
  const actualRoundTripEstimateMinutes =
    actualDriveMinutes === null ? null : Math.round(actualDriveMinutes * 2 * 10) / 10;
  const correctionFactor =
    actualRoundTripEstimateMinutes && googleRoundTripMinutes
      ? Math.round((actualRoundTripEstimateMinutes / googleRoundTripMinutes) * 100) / 100
      : null;

  const { data, error } = await supabase
    .from(STOP_METRICS_TABLE)
    .upsert(
      {
        order_id: order.id,
        route_id: route?.id || order.assignedRouteId || null,
        route_code: route?.code || null,
        order_number: order.orderNumber || null,
        driver_id: route?.driverId || null,
        driver_name: route?.driver || null,
        truck: route?.truck || route?.code || null,
        customer: order.customer || null,
        city: order.city || null,
        material: order.material || null,
        quantity: parseDispatchQuantityNumber(order.quantity),
        unit: order.unit || null,
        stop_sequence: order.stopSequence ?? null,
        google_round_trip_minutes: googleRoundTripMinutes,
        google_round_trip_miles: googleRoundTripMiles,
        google_one_way_minutes: googleOneWayMinutes,
        enroute_at: enrouteAt,
        delivered_at: deliveredAt,
        actual_drive_minutes: actualDriveMinutes,
        actual_round_trip_estimate_minutes: actualRoundTripEstimateMinutes,
        correction_factor: correctionFactor,
      },
      { onConflict: "order_id" },
    )
    .select("*")
    .single();

  if (error) {
    if (isMissingStopMetricsTable(error)) {
      console.warn("[dispatch-v2 stop metrics skipped]", formatSupabaseError(error));
      return null;
    }
    throw new Error(formatSupabaseError(error));
  }

  clearTimingInsightsCache();
  return normalizeStopMetric(data);
}

function bestTimingAverageForOrder(
  order: DispatchOrder,
  insights: DispatchTimingInsights,
  driverNameOverride = "",
) {
  const routeTiming = parseChecklist(order.checklistJson).routeTiming as Record<string, unknown> | undefined;
  const driverName = driverNameOverride || (typeof routeTiming?.driverName === "string" ? routeTiming.driverName : "");
  const driverCity = insights.byDriverCity[timingKey(driverName, order.city)];
  if (driverCity?.averageCorrectionFactor && driverCity.samples >= 2) {
    return { source: "driver + city", average: driverCity };
  }

  const driver = insights.byDriver[timingKey(driverName)];
  if (driver?.averageCorrectionFactor && driver.samples >= 3) {
    return { source: "driver", average: driver };
  }

  if (insights.globalAverage?.averageCorrectionFactor && insights.globalAverage.samples >= 5) {
    return { source: "all deliveries", average: insights.globalAverage };
  }

  return null;
}

export function getTimingMatchForOrder(
  order: DispatchOrder,
  insights: DispatchTimingInsights,
  driverNameOverride = "",
): DispatchTimingMatch | null {
  const match = bestTimingAverageForOrder(order, insights, driverNameOverride);
  if (!match) return null;
  return {
    source: match.source,
    samples: match.average.samples,
    correctionFactor: match.average.averageCorrectionFactor,
  };
}

function applyLearnedTimingEstimate(
  order: DispatchOrder,
  googleEstimate: { minutes: number; miles: number },
  insights: DispatchTimingInsights,
  driverNameOverride = "",
) {
  const match = bestTimingAverageForOrder(order, insights, driverNameOverride);
  const correctionFactor = match?.average.averageCorrectionFactor || null;
  if (!match || !correctionFactor) {
    return {
      ...googleEstimate,
      learned: false,
      detail: "",
      timingSource: "google",
      timingSamples: 0,
      correctionFactor: null,
    };
  }

  const safeFactor = Math.min(1.75, Math.max(0.65, correctionFactor));
  const learnedMinutes = Math.max(1, Math.round(googleEstimate.minutes * safeFactor));
  return {
    ...googleEstimate,
    minutes: learnedMinutes,
    learned: true,
    detail: `learned from ${match.average.samples} ${match.source} samples (${safeFactor}x Google)`,
    timingSource: match.source,
    timingSamples: match.average.samples,
    correctionFactor: safeFactor,
  };
}

async function refreshStoredTimingForAssignedDriver(order: DispatchOrder, route: DispatchRoute | null) {
  if (!route?.driver) return order;

  const existingChecklist = parseChecklist(order.checklistJson);
  const existingRouteTiming = existingChecklist.routeTiming as Record<string, unknown> | undefined;
  const googleRoundTripMinutes = numberOrNull(existingRouteTiming?.googleRoundTripMinutes);
  const googleRoundTripMiles = numberOrNull(existingRouteTiming?.googleRoundTripMiles) || Number(order.travelMiles || 0);

  if (!googleRoundTripMinutes || !googleRoundTripMiles) return order;

  const insights = await getDispatchTimingInsights(1000);
  const routeTiming = applyLearnedTimingEstimate(
    order,
    { minutes: googleRoundTripMinutes, miles: googleRoundTripMiles },
    insights,
    route.driver,
  );
  const nextChecklist = {
    ...existingChecklist,
    routeTiming: {
      ...existingRouteTiming,
      recalculatedAt: new Date().toISOString(),
      mode: routeTiming.learned ? "learned" : "google",
      source: routeTiming.timingSource,
      samples: routeTiming.timingSamples,
      driverName: route.driver || "",
      driverId: route.driverId || "",
      correctionFactor: routeTiming.correctionFactor,
      googleRoundTripMinutes,
      googleRoundTripMiles,
      finalRoundTripMinutes: routeTiming.minutes,
      finalRoundTripMiles: routeTiming.miles,
      detail: routeTiming.detail,
    },
  };

  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      travel_minutes: routeTiming.minutes,
      travel_miles: routeTiming.miles,
      checklist_json: JSON.stringify(nextChecklist),
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  return normalizeOrder(data);
}

function buildRouteViews(
  routes: DispatchRoute[],
  orders: DispatchOrder[],
  deliveredOrders: DispatchOrder[] = [],
): DispatchRouteView[] {
  return routes.map((route) => ({
    ...route,
    orders: orders
      .filter((order) => order.assignedRouteId === route.id)
      .sort(sortStops),
    deliveredOrders: deliveredOrders
      .filter((order) => order.assignedRouteId === route.id)
      .sort((left, right) => {
        const leftTime = Date.parse(left.deliveredAt || left.updatedAt || "") || 0;
        const rightTime = Date.parse(right.deliveredAt || right.updatedAt || "") || 0;
        return rightTime - leftTime;
      }),
  }));
}

async function loadDeliveredRouteOrders(routeIds: string[], options: DispatchBoardOptions = {}) {
  if (!routeIds.length) return [];
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_LIST_COLUMNS)
    .in("assigned_route_id", routeIds)
    .or("status.eq.delivered,delivery_status.eq.delivered")
    .order("delivered_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(options.dateKey ? 500 : 1000);

  if (error) throw new Error(formatSupabaseError(error));
  const deliveredOrders = (data || []).map(normalizeOrder);
  if (!options.dateKey) return deliveredOrders;
  return deliveredOrders.filter((order) => {
    const deliveredDateKey = dateKeyFromTimestampInChicago(order.deliveredAt || order.updatedAt);
    return deliveredDateKey === options.dateKey;
  });
}

async function loadActiveRoutes() {
  const { data, error } = await supabase
    .from("dispatch_routes")
    .select(ROUTE_COLUMNS)
    .eq("is_active", true)
    .order("code", { ascending: true })
    .limit(100);

  if (error) throw new Error(formatSupabaseError(error));
  return (data || []).map(normalizeRoute);
}

function normalizedIdentity(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

async function filterRoutesForDriverScope(routes: DispatchRoute[], scope?: DispatchDriverScope | null) {
  if (!scope || scope.role.role === "admin") return routes;

  const email = normalizedIdentity(scope.email || scope.role.email);
  const displayName = normalizedIdentity(scope.role.displayName);
  const directMatches = new Set([email, displayName].filter(Boolean));
  const employeeIds = new Set<string>();
  const employeeNames = new Set<string>();

  if (email || displayName) {
    try {
      const employees = await loadDispatchEmployeeOptions();
      for (const employee of employees) {
        const employeeEmail = normalizedIdentity(employee.email);
        const employeeName = normalizedIdentity(employee.name);
        if ((email && employeeEmail === email) || (displayName && employeeName === displayName)) {
          employeeIds.add(employee.id);
          employeeNames.add(employeeName);
        }
      }
    } catch (error) {
      console.warn("[dispatch-v2 driver scope employee lookup skipped]", error);
    }
  }

  return routes.filter((route) => {
    const routeDriver = normalizedIdentity(route.driver);
    return Boolean(
      (route.driverId && employeeIds.has(route.driverId)) ||
        (routeDriver && employeeNames.has(routeDriver)) ||
        (routeDriver && directMatches.has(routeDriver)),
    );
  });
}

async function getDispatchRouteById(routeId?: string | null) {
  if (!routeId) return null;
  const [{ data, error }, trucks] = await Promise.all([
    supabase
      .from("dispatch_routes")
      .select(ROUTE_COLUMNS)
      .eq("id", routeId)
      .maybeSingle(),
    loadDispatchTrucks(500),
  ]);

  if (error) throw new Error(formatSupabaseError(error));
  return data ? enrichRoutesWithTruckCapacities([normalizeRoute(data)], trucks)[0] : null;
}

async function loadActiveRouteOrders(routeId: string, options: DispatchBoardOptions = {}) {
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("assigned_route_id", routeId)
    .not("status", "in", "(delivered,cancelled)")
    .or("delivery_status.is.null,delivery_status.neq.delivered")
    .order("stop_sequence", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error(formatSupabaseError(error));
  return filterOrdersByDispatchDate((data || []).map(normalizeOrder), options).sort(sortStops);
}

export async function loadBoardState(options: DispatchBoardOptions = {}): Promise<DispatchBoardState> {
  const orderQuery = applyDispatchDatePrefilter(
    supabase
      .from("dispatch_orders")
      .select(ORDER_LIST_COLUMNS)
      .not("status", "in", "(delivered,cancelled)")
      .or("delivery_status.is.null,delivery_status.neq.delivered")
      .order("requested_window", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(options.dateKey ? 250 : 500),
    options,
  );
  const [orderResult, routeResult, trucks] = await Promise.all([
    orderQuery,
    supabase
      .from("dispatch_routes")
      .select(ROUTE_COLUMNS)
      .eq("is_active", true)
      .order("code", { ascending: true })
      .limit(100),
    loadDispatchTrucks(500),
  ]);

  if (orderResult.error) throw new Error(formatSupabaseError(orderResult.error));
  if (routeResult.error) throw new Error(formatSupabaseError(routeResult.error));

  const routes = enrichRoutesWithTruckCapacities((routeResult.data || []).map(normalizeRoute), trucks);
  const orders = filterOrdersByDispatchDate((orderResult.data || []).map(normalizeOrder), options);
  const deliveredOrders = await loadDeliveredRouteOrders(routes.map((route) => route.id), options);

  const routeViews = buildRouteViews(routes, orders, deliveredOrders);

  return {
    orders,
    routes: routeViews,
    unscheduled: orders.filter((order) => !order.assignedRouteId && order.status !== "scheduled"),
  };
}

export async function loadMonitorState(options: DispatchBoardOptions = {}): Promise<DispatchMonitorState> {
  const orderQuery = applyDispatchDatePrefilter(
    supabase
      .from("dispatch_orders")
      .select(ORDER_LIST_COLUMNS)
      .or("status.is.null,status.neq.cancelled")
      .order("requested_window", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(options.dateKey ? 350 : 1000),
    options,
  );
  const [orderResult, routeResult, trucks] = await Promise.all([
    orderQuery,
    supabase
      .from("dispatch_routes")
      .select(ROUTE_COLUMNS)
      .eq("is_active", true)
      .order("code", { ascending: true })
      .limit(100),
    loadDispatchTrucks(500),
  ]);

  if (orderResult.error) throw new Error(formatSupabaseError(orderResult.error));
  if (routeResult.error) throw new Error(formatSupabaseError(routeResult.error));

  const orders = filterOrdersByDispatchDate((orderResult.data || []).map(normalizeOrder), options);
  const routes = enrichRoutesWithTruckCapacities((routeResult.data || []).map(normalizeRoute), trucks);
  const monitorRoutes = routes.map((route) => {
    const routeOrders = orders
      .filter((order) => order.assignedRouteId === route.id)
      .sort(sortStops);
    const activeOrders = routeOrders.filter(
      (order) => order.status !== "delivered" && order.deliveryStatus !== "delivered",
    );
    const deliveredStops = routeOrders.length - activeOrders.length;
    const enrouteStops = activeOrders.filter((order) => order.deliveryStatus === "en_route").length;
    const waitingStops = activeOrders.length - enrouteStops;
    const totalTravelMinutes = routeOrders.reduce(
      (total, order) => total + Number(order.travelMinutes || 0),
      0,
    );
    const currentStop =
      activeOrders.find((order) => order.deliveryStatus === "en_route") ||
      activeOrders[0] ||
      null;
    const nextLoad =
      activeOrders.find((order) => order.deliveryStatus === "not_started") ||
      currentStop;

    return {
      ...route,
      orders: routeOrders,
      activeOrders,
      totalStops: routeOrders.length,
      deliveredStops,
      enrouteStops,
      waitingStops,
      totalTravelMinutes,
      progressPercent: routeOrders.length ? Math.round((deliveredStops / routeOrders.length) * 100) : 0,
      currentStop,
      nextLoad,
    };
  });

  const activeOrders = orders.filter(
    (order) => order.status !== "delivered" && order.deliveryStatus !== "delivered",
  );

  return {
    orders,
    routes: monitorRoutes,
    unscheduled: activeOrders.filter((order) => !order.assignedRouteId && order.status !== "scheduled"),
    totals: {
      activeRoutes: monitorRoutes.filter((route) => route.activeOrders.length > 0).length,
      activeStops: activeOrders.length,
      deliveredStops: orders.length - activeOrders.length,
      enrouteStops: activeOrders.filter((order) => order.deliveryStatus === "en_route").length,
      waitingStops: activeOrders.filter((order) => order.deliveryStatus !== "en_route").length,
      unscheduledStops: activeOrders.filter((order) => !order.assignedRouteId && order.status !== "scheduled").length,
      totalTravelMinutes: monitorRoutes.reduce((total, route) => total + route.totalTravelMinutes, 0),
    },
  };
}

export async function loadDriverLocations(routeIds: string[] = []) {
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from("dispatch_driver_locations")
    .select(
      "route_id, route_code, driver_id, driver_name, truck, latitude, longitude, accuracy, heading, speed, captured_at, updated_at",
    )
    .gte("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (routeIds.length) {
    query = query.in("route_id", routeIds);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[dispatch-v2 tracking skipped]", formatSupabaseError(error));
    return [];
  }

  return (data || [])
    .map(normalizeDriverLocation)
    .filter((location) => Number.isFinite(location.latitude) && Number.isFinite(location.longitude));
}

export async function upsertDriverLocation(input: {
  routeId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  capturedAt?: string | null;
  scope?: DispatchDriverScope | null;
}) {
  const route = await getDispatchRouteById(input.routeId);
  if (!route) throw new Error("Route not found for driver tracking.");
  const scopedRoutes = await filterRoutesForDriverScope([route], input.scope);
  if (!scopedRoutes.length) throw new Error("This route is not assigned to the current driver.");

  const now = new Date().toISOString();
  const capturedAt = input.capturedAt || now;
  const { data, error } = await supabase
    .from("dispatch_driver_locations")
    .upsert(
      {
        route_id: route.id,
        route_code: route.code,
        driver_id: route.driverId,
        driver_name: route.driver,
        truck: route.truck,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        heading: input.heading ?? null,
        speed: input.speed ?? null,
        captured_at: capturedAt,
        updated_at: now,
      },
      { onConflict: "route_id" },
    )
    .select(
      "route_id, route_code, driver_id, driver_name, truck, latitude, longitude, accuracy, heading, speed, captured_at, updated_at",
    )
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  return normalizeDriverLocation(data);
}

export async function assertDriverCanAccessOrder(orderId: string, scope?: DispatchDriverScope | null) {
  if (!scope || scope.role.role === "admin") return;

  const order = await loadOrderForMaintenance(orderId);
  if (!order?.assignedRouteId) {
    throw new Error("This stop is not assigned to the current driver.");
  }

  const route = await getDispatchRouteById(order.assignedRouteId);
  if (!route) throw new Error("Route not found for this stop.");

  const scopedRoutes = await filterRoutesForDriverScope([route], scope);
  if (!scopedRoutes.length) {
    throw new Error("This stop is not assigned to the current driver.");
  }
}

export async function loadDriverState(
  routeId?: string | null,
  options: DispatchBoardOptions = {},
  scope?: DispatchDriverScope | null,
) {
  const scopedOptions = { dateKey: options.dateKey === undefined ? todayDateKey() : options.dateKey, includeUndated: options.includeUndated !== false };
  const routes = await filterRoutesForDriverScope(await loadActiveRoutes(), scope);
  const routeIds = routes.map((route) => route.id);
  let selectedRoute = routeId ? routes.find((route) => route.id === routeId) || null : null;

  if (!selectedRoute && routeIds.length) {
    const { data: firstAssigned, error } = await applyDispatchDatePrefilter(
      supabase
        .from("dispatch_orders")
        .select(ORDER_LIST_COLUMNS)
        .in("assigned_route_id", routeIds)
        .not("assigned_route_id", "is", null)
        .not("status", "in", "(delivered,cancelled)")
        .or("delivery_status.is.null,delivery_status.neq.delivered")
        .order("stop_sequence", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(scopedOptions.dateKey ? 100 : 250),
      scopedOptions,
    );

    if (error) throw new Error(formatSupabaseError(error));
    const firstScopedOrder = filterOrdersByDispatchDate(
      (firstAssigned || []).map(normalizeOrder),
      scopedOptions,
    )[0];
    selectedRoute = routes.find((route) => route.id === firstScopedOrder?.assignedRouteId) || null;
  }

  const selectedRouteOrders = selectedRoute ? await loadActiveRouteOrders(selectedRoute.id, scopedOptions) : [];
  const selectedRouteView = selectedRoute
    ? { ...selectedRoute, orders: selectedRouteOrders }
    : null;
  const activeStops = selectedRoute
    ? selectedRouteOrders.filter((order) => order.deliveryStatus !== "delivered" && order.status !== "delivered")
    : [];
  const currentStop =
    activeStops.find((order) => order.deliveryStatus === "en_route") ||
    activeStops[0] ||
    null;

  return {
    routes,
    selectedRoute: selectedRouteView,
    currentStop,
    remainingStops: activeStops.length,
    dateKey: scopedOptions.dateKey || null,
    includeUndated: scopedOptions.includeUndated !== false,
  };
}

export async function loadLoaderState(options: DispatchBoardOptions = {}) {
  const scopedOptions = { dateKey: options.dateKey === undefined ? todayDateKey() : options.dateKey, includeUndated: options.includeUndated !== false };
  const routes = await loadActiveRoutes();
  const { data, error } = await applyDispatchDatePrefilter(
    supabase
      .from("dispatch_orders")
      .select(ORDER_COLUMNS)
      .not("assigned_route_id", "is", null)
      .not("status", "in", "(delivered,cancelled)")
      .or("delivery_status.is.null,delivery_status.neq.delivered")
      .order("assigned_route_id", { ascending: true })
      .order("stop_sequence", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(scopedOptions.dateKey ? 150 : 500),
    scopedOptions,
  );

  if (error) throw new Error(formatSupabaseError(error));
  const orders = filterOrdersByDispatchDate((data || []).map(normalizeOrder), scopedOptions).sort(sortStops);
  const routeViews = buildRouteViews(routes, orders);
  const routeLoads = routeViews
    .map((route) => {
      const nextLoad =
        route.orders.find(
          (order) =>
            order.deliveryStatus === "not_started" &&
            !parseChecklist(order.checklistJson).loaderPreparedAt,
        ) || null;
      return { route, nextLoad };
    })
    .filter((entry) => entry.nextLoad);

  return {
    routeLoads,
    totalWaiting: routeLoads.length,
    dateKey: scopedOptions.dateKey || null,
    includeUndated: scopedOptions.includeUndated !== false,
  };
}

export async function loadAuditEvents(limit = 100) {
  const { data, error } = await supabase
    .from("dispatch_audit_log")
    .select("id, action, actor, order_id, route_id, message, before_json, after_json, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(formatSupabaseError(error));
  return (data || []).map(normalizeAuditEvent);
}

function sanitizeOrderSearch(value: string) {
  return value
    .trim()
    .replace(/[%_(),]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function applyOrderListSearch(query: any, options: DispatchOrderListOptions = {}) {
  const search = sanitizeOrderSearch(options.search || "");
  if (!search) return query;

  const pattern = `%${search}%`;
  return query.or([
    `id.ilike.${pattern}`,
    `order_number.ilike.${pattern}`,
    `customer.ilike.${pattern}`,
    `contact.ilike.${pattern}`,
    `address.ilike.${pattern}`,
    `city.ilike.${pattern}`,
    `material.ilike.${pattern}`,
    `quantity.ilike.${pattern}`,
    `unit.ilike.${pattern}`,
    `requested_window.ilike.${pattern}`,
    `time_preference.ilike.${pattern}`,
    `status.ilike.${pattern}`,
    `delivery_status.ilike.${pattern}`,
  ].join(","));
}

export async function loadOrdersForMaintenance(limit = 500, options: DispatchOrderListOptions = {}) {
  const query = applyOrderListSearch(supabase
    .from("dispatch_orders")
    .select(ORDER_LIST_COLUMNS)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit), options);

  const { data, error } = await query;

  if (error) throw new Error(formatSupabaseError(error));
  return (data || []).map(normalizeOrder);
}

export async function loadDispatchPlanningOrders(limit = 1000) {
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_LIST_COLUMNS)
    .or("status.is.null,status.neq.cancelled")
    .order("requested_window", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(formatSupabaseError(error));
  return (data || []).map(normalizeOrder);
}

export async function loadOrderForMaintenance(orderId: string) {
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  return data ? normalizeOrder(data) : null;
}

export async function loadDeliveredOrders(limit = 250) {
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_LIST_COLUMNS)
    .or("status.eq.delivered,delivery_status.eq.delivered")
    .order("delivered_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(formatSupabaseError(error));
  return (data || []).map(normalizeOrder);
}

export async function loadDeliveredOrderDetail(orderId: string) {
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  return data ? normalizeOrder(data) : null;
}

export async function loadRoutesForMaintenance(limit = 200) {
  const [{ data, error }, trucks] = await Promise.all([
    supabase
      .from("dispatch_routes")
      .select(ROUTE_COLUMNS)
      .order("is_active", { ascending: false })
      .order("code", { ascending: true })
      .limit(limit),
    loadDispatchTrucks(500),
  ]);

  if (error) throw new Error(formatSupabaseError(error));
  return enrichRoutesWithTruckCapacities((data || []).map(normalizeRoute), trucks);
}

export async function loadDispatchTrucks(limit = 250) {
  const { data, error } = await supabase
    .from("dispatch_trucks")
    .select(TRUCK_COLUMNS)
    .order("is_active", { ascending: false })
    .order("truck_number", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(formatSupabaseError(error));
  }

  return (data || []).map(normalizeTruck);
}

async function resolveDispatchTruckForRoute(truckId?: string | null, truckLabel?: string | null) {
  const trucks = await loadDispatchTrucks(500);
  const normalizedTruckLabel = normalizedIdentity(truckLabel || "");

  if (truckId) {
    const byId = trucks.find((truck) => truck.id === truckId);
    if (byId) return byId;
  }

  if (!normalizedTruckLabel) return null;

  return (
    trucks.find((truck) => normalizedIdentity(truck.truckNumber) === normalizedTruckLabel) ||
    trucks.find((truck) => normalizedIdentity(truck.name) === normalizedTruckLabel) ||
    null
  );
}

function normalizeTruckCapacity(value: string | number | null | undefined, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export async function createDispatchTruck(input: DispatchTruckInput) {
  const now = new Date().toISOString();
  const truckNumber = input.truckNumber.trim();
  if (!truckNumber) throw new Error("Truck number is required.");

  const { data, error } = await supabase
    .from("dispatch_trucks")
    .insert({
      id: makeDispatchId("T"),
      truck_number: truckNumber,
      name: input.name?.trim() || null,
      tons: normalizeTruckCapacity(input.tons, DEFAULT_TRUCK_TON_CAPACITY),
      yards: normalizeTruckCapacity(input.yards, DEFAULT_TRUCK_YARD_CAPACITY),
      is_active: input.isActive !== false,
      notes: input.notes?.trim() || null,
      created_at: now,
      updated_at: now,
    })
    .select(TRUCK_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const truck = normalizeTruck(data);
  await writeAuditLog({
    action: "create_truck",
    actor: "dispatcher",
    message: `Created truck ${truck.truckNumber}.`,
    after: truck,
  });
  return truck;
}

export async function updateDispatchTruck(truckId: string, input: DispatchTruckInput) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_trucks")
    .select(TRUCK_COLUMNS)
    .eq("id", truckId)
    .maybeSingle();

  if (beforeError && !isMissingTableError(beforeError)) throw new Error(formatSupabaseError(beforeError));
  const truckNumber = input.truckNumber.trim();
  if (!truckNumber) throw new Error("Truck number is required.");

  const { data, error } = await supabase
    .from("dispatch_trucks")
    .update({
      truck_number: truckNumber,
      name: input.name?.trim() || null,
      tons: normalizeTruckCapacity(input.tons, DEFAULT_TRUCK_TON_CAPACITY),
      yards: normalizeTruckCapacity(input.yards, DEFAULT_TRUCK_YARD_CAPACITY),
      is_active: input.isActive !== false,
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", truckId)
    .select(TRUCK_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const truck = normalizeTruck(data);
  await writeAuditLog({
    action: "update_truck",
    actor: "dispatcher",
    message: `Updated truck ${truck.truckNumber}.`,
    before: beforeData ? normalizeTruck(beforeData) : null,
    after: truck,
  });
  return truck;
}

export async function deleteDispatchTruck(truckId: string) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_trucks")
    .select(TRUCK_COLUMNS)
    .eq("id", truckId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const truck = normalizeTruck(beforeData);
  const { error } = await supabase
    .from("dispatch_trucks")
    .delete()
    .eq("id", truckId);

  if (error) throw new Error(formatSupabaseError(error));
  await writeAuditLog({
    action: "delete_truck",
    actor: "dispatcher",
    message: `Deleted truck ${truck.truckNumber}.`,
    before: truck,
  });
  return truck;
}

export async function loadRouteTimingSummaries(
  options: DispatchBoardOptions = {},
): Promise<Record<string, DispatchRouteTimingSummary>> {
  const query = applyDispatchDatePrefilter(
    supabase
      .from("dispatch_orders")
      .select("assigned_route_id, travel_minutes, status, delivery_status, requested_window")
      .not("assigned_route_id", "is", null)
      .neq("status", "cancelled")
      .neq("delivery_status", "delivered")
      .limit(options.dateKey ? 750 : 2500),
    options,
  );

  const { data, error } = await query;

  if (error) throw new Error(formatSupabaseError(error));

  const summaries: Record<string, DispatchRouteTimingSummary> = {};
  for (const row of filterOrdersByDispatchDate((data || []).map(normalizeOrder), options)) {
    const routeId = String(row.assignedRouteId || "");
    if (!routeId) continue;
    const summary =
      summaries[routeId] ||
      (summaries[routeId] = {
        routeId,
        orderCount: 0,
        roundTripMinutes: 0,
        missingCount: 0,
      });
    summary.orderCount += 1;
    const minutes = numberOrNull(row.travelMinutes);
    if (minutes === null) summary.missingCount += 1;
    else summary.roundTripMinutes += minutes;
  }

  return summaries;
}

export async function loadDispatchEmployeeOptions(limit = 250) {
  const { data, error } = await supabase
    .from("dispatch_employees")
    .select("*")
    .limit(limit);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(formatSupabaseError(error));
  }

  return (data || [])
    .map(normalizeEmployeeOption)
    .filter((employee) => employee.id && employee.name && employee.isActive)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getMapsConfigStatus() {
  return {
    configured: Boolean(GOOGLE_MAPS_API_KEY),
    browserConfigured: Boolean(GOOGLE_MAPS_BROWSER_API_KEY),
    browserApiKey: GOOGLE_MAPS_BROWSER_API_KEY,
    shopAddress: DISPATCH_SHOP_ADDRESS,
  };
}

export function getDefaultDispatchOperationalSettings() {
  return { ...DEFAULT_OPERATIONAL_SETTINGS };
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumberAtLeast(value: unknown, fallback: number, minimum: number) {
  return Math.max(minimum, positiveNumber(value, fallback));
}

function booleanFromSetting(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return fallback;
}

function normalizeOperationalSettings(value: unknown): DispatchOperationalSettings {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    shopAddress: String(row.shopAddress || DEFAULT_OPERATIONAL_SETTINGS.shopAddress),
    defaultImportLimit: positiveNumber(
      row.defaultImportLimit,
      DEFAULT_OPERATIONAL_SETTINGS.defaultImportLimit,
    ),
    defaultImportSinceDays: positiveNumber(
      row.defaultImportSinceDays,
      DEFAULT_OPERATIONAL_SETTINGS.defaultImportSinceDays,
    ),
    calculateDistancesOnImport: booleanFromSetting(
      row.calculateDistancesOnImport,
      DEFAULT_OPERATIONAL_SETTINGS.calculateDistancesOnImport,
    ),
    distanceLimit: positiveNumber(row.distanceLimit, DEFAULT_OPERATIONAL_SETTINGS.distanceLimit),
    mapRefreshSeconds: positiveNumberAtLeast(
      row.mapRefreshSeconds,
      DEFAULT_OPERATIONAL_SETTINGS.mapRefreshSeconds,
      30,
    ),
    driverLocationSeconds: positiveNumberAtLeast(
      row.driverLocationSeconds,
      DEFAULT_OPERATIONAL_SETTINGS.driverLocationSeconds,
      45,
    ),
    driverReleaseDelayMinutes: positiveNumber(
      row.driverReleaseDelayMinutes,
      DEFAULT_OPERATIONAL_SETTINGS.driverReleaseDelayMinutes,
    ),
    quickDeliverEnabled: booleanFromSetting(
      row.quickDeliverEnabled,
      DEFAULT_OPERATIONAL_SETTINGS.quickDeliverEnabled,
    ),
    chimeEnabled: booleanFromSetting(row.chimeEnabled, DEFAULT_OPERATIONAL_SETTINGS.chimeEnabled),
    defaultDispatchDateMode: String(
      row.defaultDispatchDateMode || DEFAULT_OPERATIONAL_SETTINGS.defaultDispatchDateMode,
    ),
    loaderAutoAdvance: booleanFromSetting(
      row.loaderAutoAdvance,
      DEFAULT_OPERATIONAL_SETTINGS.loaderAutoAdvance,
    ),
  };
}

export async function loadDispatchOperationalSettings() {
  const { data, error } = await supabase
    .from("dispatch_settings")
    .select("value")
    .eq("key", "operations")
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  return normalizeOperationalSettings(data?.value);
}

export async function saveDispatchOperationalSettings(
  input: Partial<DispatchOperationalSettings>,
  actor: string,
) {
  const current = await loadDispatchOperationalSettings().catch(() => DEFAULT_OPERATIONAL_SETTINGS);
  const next = normalizeOperationalSettings({ ...current, ...input });
  const { data, error } = await supabase
    .from("dispatch_settings")
    .upsert(
      {
        key: "operations",
        value: next,
        updated_by: actor,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    )
    .select("value")
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  await writeAuditLog({
    action: "settings_update",
    actor,
    message: "Dispatch operations settings updated.",
    before: current,
    after: next,
  });
  return normalizeOperationalSettings(data?.value);
}

export function getDispatchSystemStatus(): DispatchSystemStatus {
  return {
    supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
    shopifyDomainConfigured: Boolean(SHOPIFY_SHOP_DOMAIN),
    shopifyAccessTokenConfigured: Boolean(SHOPIFY_ADMIN_ACCESS_TOKEN),
    shopifyApiCredentialsConfigured: Boolean(SHOPIFY_API_KEY && SHOPIFY_API_SECRET),
    shopifyImportReady: Boolean(
      SHOPIFY_SHOP_DOMAIN && (SHOPIFY_ADMIN_ACCESS_TOKEN || (SHOPIFY_API_KEY && SHOPIFY_API_SECRET)),
    ),
    googleMapsServerConfigured: Boolean(GOOGLE_MAPS_API_KEY),
    googleMapsBrowserConfigured: Boolean(GOOGLE_MAPS_BROWSER_API_KEY),
    importSecretConfigured: Boolean(process.env.DISPATCH_IMPORT_SECRET),
    distanceSecretConfigured: Boolean(process.env.DISTANCE_CALC_SECRET || process.env.DISPATCH_IMPORT_SECRET),
    shopAddress: DISPATCH_SHOP_ADDRESS,
    nodeVersion: process.version,
  };
}

export async function calculateOrderDistance(orderId: string) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeOrder(beforeData);
  const destinationAddress = fullDeliveryAddress(before);
  if (!destinationAddress) {
    throw new Error(`Order ${before.orderNumber} has no delivery address.`);
  }

  const googleRoute = await computeRoundTripRoute(destinationAddress);
  const insights = await getDispatchTimingInsights(1000);
  const assignedRoute = before.assignedRouteId ? await getDispatchRouteById(before.assignedRouteId) : null;
  const route = applyLearnedTimingEstimate(before, googleRoute, insights, assignedRoute?.driver || "");
  const checklist = {
    ...parseChecklist(before.checklistJson),
    routeTiming: {
      calculatedAt: new Date().toISOString(),
      mode: route.learned ? "learned" : "google",
      source: route.timingSource,
      samples: route.timingSamples,
      driverName: assignedRoute?.driver || "",
      driverId: assignedRoute?.driverId || "",
      correctionFactor: route.correctionFactor,
      googleRoundTripMinutes: googleRoute.minutes,
      googleRoundTripMiles: googleRoute.miles,
      finalRoundTripMinutes: route.minutes,
      finalRoundTripMiles: route.miles,
      detail: route.detail,
    },
  };
  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      travel_minutes: route.minutes,
      travel_miles: route.miles,
      checklist_json: JSON.stringify(checklist),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  let updatedOrder = normalizeOrder(data);
  await writeAuditLog({
    action: "calculate_distance",
    actor: "maps",
    orderId,
    routeId: updatedOrder.assignedRouteId,
    message: route.learned
      ? `Calculated ${updatedOrder.orderNumber}: ${route.minutes} min learned round trip, ${route.miles} mi (${route.detail}).`
      : `Calculated ${updatedOrder.orderNumber}: ${route.minutes} min Google round trip, ${route.miles} mi.`,
    before,
    after: {
      ...updatedOrder,
      googleRoundTripMinutes: googleRoute.minutes,
      learnedTimingDetail: route.detail,
    },
  });
  return updatedOrder;
}

export async function calculateBoardDistances(
  options: DispatchBoardOptions & { mode?: "missing" | "all"; limit?: number } = {},
): Promise<DistanceCalculationResult> {
  const board = await loadBoardState(options);
  const maxOrders = Math.max(1, Math.min(Number(options.limit || 40), 100));
  const missingAddress = board.orders.filter((order) => !fullDeliveryAddress(order));
  const alreadyCalculated =
    options.mode === "all"
      ? []
      : board.orders.filter(
          (order) =>
            fullDeliveryAddress(order) &&
            Number(order.travelMinutes || 0) > 0 &&
            Number(order.travelMiles || 0) > 0,
        );
  const eligibleCandidates = board.orders
    .filter((order) => fullDeliveryAddress(order))
    .filter((order) => options.mode === "all" || !order.travelMinutes || !order.travelMiles);
  const candidates = eligibleCandidates.slice(0, maxOrders);
  const details: string[] = [];
  let updated = 0;
  let skipped = board.orders.length - candidates.length;

  if (!board.orders.length) {
    details.push("No active orders matched the selected board date/filter.");
  }

  if (alreadyCalculated.length) {
    details.push(`${alreadyCalculated.length} orders already had round-trip time and miles.`);
  }

  if (missingAddress.length) {
    details.push(
      `${missingAddress.length} orders skipped because they are missing a delivery address: ${missingAddress
        .slice(0, 5)
        .map((order) => order.orderNumber)
        .join(", ")}${missingAddress.length > 5 ? "..." : ""}`,
    );
  }

  if (eligibleCandidates.length > maxOrders) {
    details.push(`Limited to the first ${maxOrders} of ${eligibleCandidates.length} eligible orders for this run.`);
  }

  for (const order of candidates) {
    try {
      const updatedOrder = await calculateOrderDistance(order.id);
      updated += 1;
      details.push(`${updatedOrder.orderNumber}: ${updatedOrder.travelMinutes} min RT, ${updatedOrder.travelMiles} mi.`);
    } catch (error) {
      skipped += 1;
      details.push(`${order.orderNumber}: skipped - ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const message = `Distance calculation complete: ${updated} updated, ${skipped} skipped from ${board.orders.length} active orders.`;
  await writeAuditLog({
    action: "calculate_board_distances",
    actor: "maps",
    message,
    after: { updated, skipped, checked: candidates.length, dateKey: options.dateKey || null, mode: options.mode || "missing" },
  });

  return {
    ok: true,
    checked: candidates.length,
    updated,
    skipped,
    message,
    details,
  };
}

function numberFromUnknown(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nullableNumberFromUnknown(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeQuoteAudience(value: unknown): DispatchQuoteAudience {
  if (value === "contractor") return "contractor";
  if (value === "custom") return "custom";
  return "customer";
}

function normalizeQuoteTier(value: unknown): DispatchQuoteTier {
  return value === "tier2" ? "tier2" : "tier1";
}

function quotePricingLabel(audience: DispatchQuoteAudience, contractorTier: DispatchQuoteTier) {
  if (audience === "contractor") return contractorTier === "tier2" ? "Contractor Tier 2" : "Contractor Tier 1";
  if (audience === "custom") return "Custom";
  return "Customer";
}

function quoteUnitPrice(product: DispatchQuoteProduct, audience: DispatchQuoteAudience, tier: DispatchQuoteTier) {
  if (audience === "contractor") {
    if (tier === "tier2") return product.contractorTier2Price ?? product.contractorTier1Price ?? product.price;
    return product.contractorTier1Price ?? product.contractorTier2Price ?? product.price;
  }

  return product.price;
}

function normalizeQuoteUnitLabel(value: string) {
  const normalized = normalizeDispatchUnitLabel(value);
  if (normalized) return normalized;
  return String(value || "").replace(/^per\s+/i, "").trim();
}

export async function loadDispatchQuoteProducts(): Promise<DispatchQuoteProduct[]> {
  const { data, error } = await supabase
    .from("product_source_map")
    .select("*")
    .order("product_title", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(formatSupabaseError(error));
  }

  return ((data || []) as Array<Record<string, unknown>>)
    .filter((row) => row.sku)
    .map((row) => ({
      sku: String(row.sku || ""),
      variantId: String(row.variant_id || ""),
      title: cleanShopifyMaterialName(String(row.product_title || row.sku || "")),
      vendor: cleanShopifyMaterialName(String(row.pickup_vendor || "")),
      imageUrl: String(row.image_url || ""),
      unitLabel: normalizeQuoteUnitLabel(String(row.unit_label || row.price_unit_label || "")),
      price: numberFromUnknown(row.price),
      contractorTier1Price: nullableNumberFromUnknown(row.contractor_tier_1_price ?? row.tier_1_price),
      contractorTier2Price: nullableNumberFromUnknown(row.contractor_tier_2_price ?? row.tier_2_price),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function companyAddressParts(address: any) {
  return {
    address1: String(address?.address1 || ""),
    address2: String(address?.address2 || ""),
    city: String(address?.city || ""),
    province: String(address?.zoneCode || address?.provinceCode || address?.province || ""),
    postalCode: String(address?.zip || address?.postalCode || ""),
    country: String(address?.countryCode || address?.countryCodeV2 || address?.country || "US"),
    phone: String(address?.phone || ""),
  };
}

function mapB2BCompanyRow(row: Record<string, unknown>): DispatchB2BCompany {
  const rawCatalogTitles = row.catalog_titles;
  const catalogTitles = Array.isArray(rawCatalogTitles)
    ? rawCatalogTitles.map(String)
    : [];

  return {
    id: String(row.id || ""),
    shopifyCompanyId: String(row.shopify_company_id || ""),
    shopifyCompanyContactId: String(row.shopify_company_contact_id || ""),
    shopifyLocationId: String(row.shopify_location_id || ""),
    companyName: String(row.company_name || ""),
    contractorTier: normalizeQuoteTier(row.contractor_tier),
    catalogTitles,
    contactName: String(row.contact_name || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    billingAddress1: String(row.billing_address1 || ""),
    billingAddress2: String(row.billing_address2 || ""),
    billingCity: String(row.billing_city || ""),
    billingProvince: String(row.billing_province || ""),
    billingPostalCode: String(row.billing_postal_code || ""),
    billingCountry: String(row.billing_country || "US"),
    taxExempt: Boolean(row.tax_exempt),
    paymentTermsName: String(row.payment_terms_name || ""),
    paymentTermsTemplateId: String(row.payment_terms_template_id || ""),
    paymentTermsDueInDays: nullableNumberFromUnknown(row.payment_terms_due_in_days),
    updatedAt: String(row.updated_at || ""),
  };
}

export async function loadDispatchB2BCompanies(): Promise<DispatchB2BCompany[]> {
  const { data, error } = await supabase
    .from("dispatch_b2b_companies")
    .select("*")
    .order("company_name", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(formatSupabaseError(error));
  }

  return ((data || []) as Array<Record<string, unknown>>)
    .filter((row) => row.company_name)
    .map(mapB2BCompanyRow);
}

export async function syncShopifyB2BCompanies(limit = 250): Promise<ShopifyImportResult> {
  const details: string[] = [];
  const rows: Array<Record<string, unknown>> = [];
  let after: string | null = null;
  let fetched = 0;

  do {
    const data = await shopifyGraphql<{
      companies?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: Array<{
          id: string;
          name?: string | null;
          updatedAt?: string | null;
          mainContact?: {
            id?: string | null;
            customer?: {
              displayName?: string | null;
              email?: string | null;
              phone?: string | null;
              defaultAddress?: Record<string, unknown> | null;
            } | null;
          } | null;
          locations?: {
            nodes?: Array<{
              id?: string | null;
              name?: string | null;
              phone?: string | null;
              billingAddress?: Record<string, unknown> | null;
              shippingAddress?: Record<string, unknown> | null;
              taxSettings?: {
                taxExempt?: boolean | null;
                taxExemptions?: string[] | null;
              } | null;
              catalogs?: {
                nodes?: Array<{
                  id?: string | null;
                  title?: string | null;
                  status?: string | null;
                }> | null;
              } | null;
              buyerExperienceConfiguration?: {
                paymentTermsTemplate?: {
                  id?: string | null;
                  name?: string | null;
                  dueInDays?: number | null;
                } | null;
              } | null;
            }> | null;
          } | null;
        }> | null;
      };
    }>(
      `#graphql
      query DispatchB2BCompanies($first: Int!, $after: String) {
        companies(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            name
            updatedAt
            mainContact {
              id
              customer {
                displayName
                email
                phone
                defaultAddress {
                  address1
                  address2
                  city
                  province
                  provinceCode
                  zip
                  country
                  countryCodeV2
                  phone
                }
              }
            }
            locations(first: 10) {
              nodes {
                id
                name
                phone
                billingAddress {
                  address1
                  address2
                  city
                  zoneCode
                  zip
                  country
                  countryCode
                  phone
                }
                shippingAddress {
                  address1
                  address2
                  city
                  zoneCode
                  zip
                  country
                  countryCode
                  phone
                }
                taxSettings {
                  taxExempt
                  taxExemptions
                }
                catalogs(first: 10) {
                  nodes {
                    id
                    title
                    status
                  }
                }
                buyerExperienceConfiguration {
                  paymentTermsTemplate {
                    id
                    name
                    dueInDays
                  }
                }
              }
            }
          }
        }
      }`,
      { first: Math.min(100, Math.max(1, limit - fetched)), after },
    );

    const companies = data.companies?.nodes || [];
    for (const company of companies) {
      fetched += 1;
      const location = company.locations?.nodes?.[0] || null;
      const customer = company.mainContact?.customer || null;
      const billing = companyAddressParts(
        location?.billingAddress || customer?.defaultAddress || location?.shippingAddress || null,
      );
      const phone = String(location?.phone || customer?.phone || billing.phone || "");
      const companyName = String(company.name || "").trim();
      const catalogTitles = (location?.catalogs?.nodes || [])
        .map((catalog) => String(catalog?.title || "").trim())
        .filter(Boolean);
      const catalogSearch = catalogTitles.join(" ").toLowerCase();
      const contractorTier = /level\s*2\s+contractor|tier\s*2/.test(catalogSearch)
        ? "tier2"
        : /level\s*1\s+contractor|tier\s*1/.test(catalogSearch)
          ? "tier1"
          : "tier1";
      const paymentTerms = location?.buyerExperienceConfiguration?.paymentTermsTemplate || null;

      if (!company.id || !companyName) {
        details.push(`Skipped B2B company with missing id/name.`);
        continue;
      }

      rows.push({
        id: String(location?.id || company.id),
        shopify_company_id: company.id,
        shopify_company_contact_id: String(company.mainContact?.id || ""),
        shopify_location_id: String(location?.id || ""),
        company_name: companyName,
        contractor_tier: contractorTier,
        catalog_titles: catalogTitles,
        contact_name: String(customer?.displayName || ""),
        email: String(customer?.email || ""),
        phone,
        billing_address1: billing.address1,
        billing_address2: billing.address2,
        billing_city: billing.city,
        billing_province: billing.province,
        billing_postal_code: billing.postalCode,
        billing_country: billing.country,
        tax_exempt: Boolean(location?.taxSettings?.taxExempt || (location?.taxSettings?.taxExemptions || []).length),
        payment_terms_name: String(paymentTerms?.name || ""),
        payment_terms_template_id: String(paymentTerms?.id || ""),
        payment_terms_due_in_days: paymentTerms?.dueInDays ?? null,
        raw_json: company,
        updated_at: new Date().toISOString(),
      });
    }

    after = data.companies?.pageInfo?.hasNextPage ? data.companies?.pageInfo?.endCursor || null : null;
  } while (after && fetched < limit);

  if (rows.length) {
    const { error } = await supabase
      .from("dispatch_b2b_companies")
      .upsert(rows, { onConflict: "id" });

    if (error) throw new Error(formatSupabaseError(error));
  }

  return {
    ok: true,
    imported: rows.length,
    updated: 0,
    skipped: Math.max(0, fetched - rows.length),
    distanceUpdated: 0,
    distanceSkipped: 0,
    message: `Shopify B2B company sync complete: ${rows.length} companies cached.`,
    details: details.length ? details : [`Fetched ${fetched} Shopify B2B companies.`],
  };
}

export async function calculateDispatchQuote(input: DispatchQuoteInput): Promise<DispatchQuoteResult> {
  const audience = normalizeQuoteAudience(input.audience);
  const contractorTier = normalizeQuoteTier(input.contractorTier);
  const products = await loadDispatchQuoteProducts();
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const lineItems: DispatchQuoteResult["lineItems"] = [];

  for (const line of input.lines) {
    const quantity = Math.max(0, Number(line.quantity || 0));
    if (!line.sku || quantity <= 0) continue;

    const product = productBySku.get(line.sku);
    if (!product && !line.customTitle) continue;

    const title = cleanShopifyMaterialName(line.customTitle || product?.title || line.sku);
    const unitPrice =
      audience === "custom" && line.customUnitPrice !== null && line.customUnitPrice !== undefined
        ? Number(line.customUnitPrice || 0)
        : product
          ? quoteUnitPrice(product, audience, contractorTier)
          : 0;

    lineItems.push({
      sku: line.sku,
      title,
      vendor: product?.vendor || "Custom",
      quantity,
      unitLabel: product?.unitLabel || "Unit",
      unitPrice,
      lineTotal: unitPrice * quantity,
    });
  }

  const productTotal = lineItems.reduce((total, line) => total + line.lineTotal, 0);
  const customShippingQuantity = nullableNumberFromUnknown(input.customShippingQuantity);
  const customShippingRate = nullableNumberFromUnknown(input.customShippingRate);
  let deliveryTotal = 0;
  let deliveryService = "Delivery not calculated";
  let deliveryNotes = "Enter an address or custom shipping amount to calculate delivery.";
  let roundTripMinutes: number | null = null;
  let roundTripMiles: number | null = null;

  if (customShippingQuantity !== null && customShippingRate !== null) {
    deliveryTotal = customShippingQuantity * customShippingRate;
    deliveryService = input.customShippingLabel || "Custom Shipping";
    deliveryNotes = `${customShippingQuantity} x $${customShippingRate.toFixed(2)}`;
  } else {
    const destinationAddress = [input.address1, input.city].filter(Boolean).join(", ").trim();
    if (destinationAddress) {
      try {
        const route = await computeRoundTripRoute(destinationAddress);
        roundTripMinutes = route.minutes;
        roundTripMiles = route.miles;
        deliveryTotal = Math.round(route.minutes * 2.08 * 100) / 100;
        deliveryService = "Calculated Delivery";
        deliveryNotes = `${route.minutes} min round trip (${route.miles} mi)`;
      } catch (error) {
        deliveryService = "Call for delivery quote";
        deliveryNotes = error instanceof Error ? error.message : "Unable to calculate delivery route.";
      }
    }
  }

  const taxTotal = input.taxExempt ? 0 : Math.round(productTotal * 0.055 * 100) / 100;
  const grandTotal = productTotal + deliveryTotal + taxTotal;
  const sourceByVendor = new Map<string, { vendor: string; quantity: number; items: string[] }>();

  for (const line of lineItems) {
    const vendor = line.vendor || "Green Hills Supply";
    const existing = sourceByVendor.get(vendor) || { vendor, quantity: 0, items: [] };
    existing.quantity += line.quantity;
    existing.items.push(`${line.title} (${line.sku})`);
    sourceByVendor.set(vendor, existing);
  }

  return {
    pricingLabel: quotePricingLabel(audience, contractorTier),
    productTotal,
    deliveryTotal,
    taxTotal,
    grandTotal,
    deliveryService,
    deliveryNotes,
    roundTripMinutes,
    roundTripMiles,
    lineItems,
    sourceBreakdown: Array.from(sourceByVendor.values()),
  };
}

export function getShopifyImportConfigStatus() {
  return {
    configured: Boolean(SHOPIFY_SHOP_DOMAIN && (SHOPIFY_ADMIN_ACCESS_TOKEN || (SHOPIFY_API_KEY && SHOPIFY_API_SECRET))),
    shopDomain: SHOPIFY_SHOP_DOMAIN ? normalizeShopDomain(SHOPIFY_SHOP_DOMAIN) : "",
    apiVersion: SHOPIFY_API_VERSION,
    authMode: SHOPIFY_ADMIN_ACCESS_TOKEN ? "access-token" : "client-credentials",
  };
}

function shopifyVariantDisplayTitle(productTitle: string, variantTitle?: string | null) {
  const product = cleanShopifyMaterialName(productTitle);
  const variant = cleanShopifyMaterialName(variantTitle);
  if (!variant || /^default title$/i.test(variant)) return product;
  if (product.toLowerCase().includes(variant.toLowerCase())) return product;
  return `${product} - ${variant}`;
}

async function getShopifyAccessToken() {
  if (SHOPIFY_ADMIN_ACCESS_TOKEN) return SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!SHOPIFY_SHOP_DOMAIN || !SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN plus either SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_API_KEY and SHOPIFY_API_SECRET.");
  }

  const now = Date.now();
  if (cachedShopifyAccessToken && cachedShopifyAccessTokenExpiresAt > now + 60_000) {
    return cachedShopifyAccessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
  });

  const response = await fetch(`https://${normalizeShopDomain(SHOPIFY_SHOP_DOMAIN)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(
      [
        payload.error_description || payload.error || `Shopify token request failed with HTTP ${response.status}.`,
        `Shop domain: ${normalizeShopDomain(SHOPIFY_SHOP_DOMAIN)}.`,
        `API key ending: ${redactedEnding(SHOPIFY_API_KEY)}.`,
        "Make sure this is the app's Client ID/API key, the matching Client Secret/API secret, and the app is installed on this exact store.",
      ].join(" "),
    );
  }

  cachedShopifyAccessToken = payload.access_token;
  cachedShopifyAccessTokenExpiresAt = now + Number(payload.expires_in || 86400) * 1000;
  return cachedShopifyAccessToken;
}

type ShopifyUserError = {
  field?: string[] | null;
  message?: string | null;
};

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string | null }>;
};

export async function shopifyGraphql<T>(query: string, variables: Record<string, unknown>) {
  if (!SHOPIFY_SHOP_DOMAIN) throw new Error("Missing SHOPIFY_SHOP_DOMAIN.");
  const accessToken = await getShopifyAccessToken();
  const response = await fetch(
    `https://${normalizeShopDomain(SHOPIFY_SHOP_DOMAIN)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const body = await response.json() as ShopifyGraphqlResponse<T>;
  if (!response.ok || body.errors?.length) {
    const message = body.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || `Shopify GraphQL failed with HTTP ${response.status}.`);
  }
  return body.data as T;
}

export async function syncShopifyProductSourceMap(limit = 500): Promise<ShopifyImportResult> {
  const details: string[] = [];
  const rows: Array<{
    sku: string;
    variant_id: string | null;
    product_title: string;
    pickup_vendor: string;
    image_url: string | null;
    unit_label: string | null;
    price: number | null;
    updated_at: string;
  }> = [];
  let after: string | null = null;
  let productCount = 0;

  do {
    const data = await shopifyGraphql<{
      products?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: Array<{
          title?: string | null;
          vendor?: string | null;
          featuredImage?: { url?: string | null } | null;
          unitLabel?: { value?: string | null } | null;
          legacyUnitLabel?: { value?: string | null } | null;
          variants?: {
            nodes?: Array<{
              id?: string | null;
              sku?: string | null;
              title?: string | null;
              price?: string | number | null;
              image?: { url?: string | null } | null;
            }>;
          };
        }>;
      };
    }>(
      `
        query DispatchProductSourceSync($first: Int!, $after: String) {
          products(first: $first, after: $after, sortKey: TITLE) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              title
              vendor
              featuredImage {
                url
              }
              unitLabel: metafield(namespace: "green_hills", key: "price_unit_label") {
                value
              }
              legacyUnitLabel: metafield(namespace: "$app", key: "price_unit_label") {
                value
              }
              variants(first: 100) {
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
      `,
      { first: 100, after },
    );

    const products = data.products?.nodes || [];
    productCount += products.length;
    for (const product of products) {
      const productTitle = cleanShopifyMaterialName(product.title);
      const vendor = cleanShopifyMaterialName(product.vendor);
      const imageUrl = product.featuredImage?.url || null;
      const unitLabel = normalizeDispatchUnitLabel(
        product.unitLabel?.value || product.legacyUnitLabel?.value || "",
      ) || null;

      for (const variant of product.variants?.nodes || []) {
        const sku = cleanShopifyMaterialName(variant.sku);
        if (!sku) continue;
        rows.push({
          sku,
          variant_id: variant.id || null,
          product_title: shopifyVariantDisplayTitle(productTitle, variant.title),
          pickup_vendor: vendor,
          image_url: variant.image?.url || imageUrl,
          unit_label: unitLabel,
          price:
            variant.price === null || variant.price === undefined || variant.price === ""
              ? null
              : Number(variant.price),
          updated_at: new Date().toISOString(),
        });
      }
    }

    after = data.products?.pageInfo?.hasNextPage ? data.products.pageInfo.endCursor || null : null;
  } while (after && rows.length < limit);

  const uniqueRows = Array.from(new Map(rows.slice(0, limit).map((row) => [row.sku, row])).values());
  for (let index = 0; index < uniqueRows.length; index += 100) {
    const chunk = uniqueRows.slice(index, index + 100);
    const { error } = await supabase
      .from("product_source_map")
      .upsert(chunk, { onConflict: "sku" });
    if (error) throw new Error(formatSupabaseError(error));
  }

  details.push(`Scanned ${productCount} Shopify products.`);
  details.push(`Synced ${uniqueRows.length} SKU rows into product_source_map.`);
  details.push(
    `Sample names: ${uniqueRows
      .slice(0, 20)
      .map((row) => `${row.sku}: ${row.product_title}`)
      .join("; ") || "none"}.`,
  );

  return {
    ok: true,
    mode: "sync",
    imported: 0,
    updated: uniqueRows.length,
    skipped: Math.max(0, rows.length - uniqueRows.length),
    message: `Product name sync complete: ${uniqueRows.length} SKUs updated from Shopify.`,
    details,
  };
}

export async function repairDispatchOrderMaterialsFromProductSourceMap(limit = 1000): Promise<ShopifyImportResult> {
  const details: string[] = [];
  const { data: orderRows, error: orderError } = await supabase
    .from("dispatch_orders")
    .select("id, order_number, material, checklist_json, status, delivery_status, updated_at")
    .not("checklist_json", "is", null)
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 5000)));

  if (orderError) throw new Error(formatSupabaseError(orderError));

  const orders = orderRows || [];
  const skus = Array.from(
    new Set(
      orders
        .map((row) => cleanShopifyMaterialName(parseChecklist(row.checklist_json).sku as string))
        .filter(Boolean),
    ),
  );

  if (!skus.length) {
    return {
      ok: true,
      mode: "updates",
      imported: 0,
      updated: 0,
      skipped: orders.length,
      message: "No Shopify SKUs found on existing dispatch tickets.",
      details: ["Existing dispatch tickets did not have checklist_json.sku values to repair from."],
    };
  }

  const { data: productRows, error: productError } = await supabase
    .from("product_source_map")
    .select("sku, product_title")
    .in("sku", skus);

  if (productError) throw new Error(formatSupabaseError(productError));

  const productTitleBySku = new Map(
    (productRows || [])
      .map((row) => [cleanShopifyMaterialName(row.sku), cleanShopifyMaterialName(row.product_title)] as const)
      .filter(([, title]) => Boolean(title)),
  );

  let updated = 0;
  let skipped = 0;
  const changedExamples: string[] = [];
  const missingExamples: string[] = [];

  for (const row of orders) {
    const checklist = parseChecklist(row.checklist_json);
    const sku = cleanShopifyMaterialName(checklist.sku as string);
    const mappedTitle = sku ? productTitleBySku.get(sku) || "" : "";
    const currentMaterial = cleanShopifyMaterialName(row.material);

    if (!sku || !mappedTitle) {
      skipped += 1;
      if (missingExamples.length < 12) {
        missingExamples.push(`${row.order_number || row.id}: ${sku || "no sku"} has no product_source_map title`);
      }
      continue;
    }

    if (mappedTitle === currentMaterial) {
      skipped += 1;
      continue;
    }

    const nextChecklist = {
      ...checklist,
      repairedMaterialAt: new Date().toISOString(),
      repairedMaterialFrom: currentMaterial,
      repairedMaterialTo: mappedTitle,
    };
    const { error } = await supabase
      .from("dispatch_orders")
      .update({
        material: mappedTitle,
        checklist_json: JSON.stringify(nextChecklist),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (error) throw new Error(formatSupabaseError(error));
    updated += 1;
    if (changedExamples.length < 20) {
      changedExamples.push(`${row.order_number || row.id}: ${currentMaterial || "(blank)"} -> ${mappedTitle}`);
    }
  }

  if (changedExamples.length) details.push(`Changed: ${changedExamples.join("; ")}.`);
  if (missingExamples.length) details.push(`Missing map rows: ${missingExamples.join("; ")}.`);
  details.push(`Checked ${orders.length} dispatch tickets and ${productTitleBySku.size} mapped SKUs.`);

  return {
    ok: true,
    mode: "updates",
    imported: 0,
    updated,
    skipped,
    message: `Existing ticket material repair complete: ${updated} updated, ${skipped} skipped.`,
    details,
  };
}

function shopifyUserErrorMessage(errors?: ShopifyUserError[]) {
  return (errors || [])
    .map((error) => [error.field?.join("."), error.message].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
}

function shopifyChecklist(order: DispatchOrder) {
  return parseChecklist(order.checklistJson) as Record<string, unknown> & {
    shopifyOrderId?: string;
    shopifyOrderName?: string;
    shopifyLineItemId?: string;
    shopifyFulfillmentId?: string;
    shopifyFulfillmentStatus?: string;
    shopifyFulfilledAt?: string;
    shopifyDeliveredAt?: string;
    sku?: string;
  };
}

function normalizeShopifyMatchText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function saveShopifyChecklist(order: DispatchOrder, updates: Record<string, unknown>) {
  const checklist = updateChecklistValue(order, updates);
  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      checklist_json: JSON.stringify(checklist),
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  return normalizeOrder(data);
}

function matchesShopifyFulfillmentLine(order: DispatchOrder, checklist: ReturnType<typeof shopifyChecklist>, lineItem: any) {
  const line = lineItem?.lineItem || {};
  const targetLineItemId = String(checklist.shopifyLineItemId || "");
  if (targetLineItemId && line.id === targetLineItemId) return true;

  const targetSku = normalizeShopifyMatchText(checklist.sku);
  const lineSku = normalizeShopifyMatchText(line.sku);
  if (targetSku && lineSku && targetSku === lineSku) return true;

  const material = normalizeShopifyMatchText(order.material);
  const lineName = normalizeShopifyMatchText(`${line.name || ""} ${line.title || ""}`);
  return Boolean(material && lineName && (lineName.includes(material) || material.includes(lineName)));
}

async function fulfillShopifyDispatchOrder(order: DispatchOrder, reason: string) {
  const checklist = shopifyChecklist(order);
  if (!checklist.shopifyOrderId) {
    return { ok: false, skipped: true, message: "No Shopify order id on dispatch ticket.", order };
  }

  if (checklist.shopifyFulfillmentId) {
    return {
      ok: true,
      skipped: true,
      message: `Shopify fulfillment already exists for ${order.orderNumber}.`,
      order,
      fulfillmentId: checklist.shopifyFulfillmentId,
    };
  }

  const data = await shopifyGraphql<{
    order?: {
      id: string;
      name: string;
      fulfillmentOrders?: {
        nodes?: Array<{
          id: string;
          status?: string;
          lineItems?: {
            nodes?: Array<{
              id: string;
              remainingQuantity?: number;
              totalQuantity?: number;
              lineItem?: {
                id?: string;
                sku?: string | null;
                name?: string | null;
                title?: string | null;
              } | null;
            }>;
          };
        }>;
      };
    } | null;
  }>(
    `
      query DispatchFulfillmentTargets($id: ID!) {
        order(id: $id) {
          id
          name
          fulfillmentOrders(first: 20) {
            nodes {
              id
              status
              lineItems(first: 50) {
                nodes {
                  id
                  remainingQuantity
                  totalQuantity
                  lineItem {
                    id
                    sku
                    name
                    title
                  }
                }
              }
            }
          }
        }
      }
    `,
    { id: checklist.shopifyOrderId },
  );

  const fulfillmentOrders = data.order?.fulfillmentOrders?.nodes || [];
  let neededQuantity = Math.max(1, Math.round(orderQuantity(order) || 1));
  const lineItemsByFulfillmentOrder: Array<{
    fulfillmentOrderId: string;
    fulfillmentOrderLineItems: Array<{ id: string; quantity: number }>;
  }> = [];

  for (const fulfillmentOrder of fulfillmentOrders) {
    const lineItems = fulfillmentOrder.lineItems?.nodes || [];
    const matchedLineItems = lineItems.filter((lineItem) => {
      const remaining = Number(lineItem.remainingQuantity || 0);
      return remaining > 0 && matchesShopifyFulfillmentLine(order, checklist, lineItem);
    });
    const fulfillmentOrderLineItems: Array<{ id: string; quantity: number }> = [];

    for (const lineItem of matchedLineItems) {
      if (neededQuantity <= 0) break;
      const quantity = Math.min(neededQuantity, Number(lineItem.remainingQuantity || 0));
      if (quantity <= 0) continue;
      fulfillmentOrderLineItems.push({ id: lineItem.id, quantity });
      neededQuantity -= quantity;
    }

    if (fulfillmentOrderLineItems.length) {
      lineItemsByFulfillmentOrder.push({
        fulfillmentOrderId: fulfillmentOrder.id,
        fulfillmentOrderLineItems,
      });
    }

    if (neededQuantity <= 0) break;
  }

  if (!lineItemsByFulfillmentOrder.length) {
    return {
      ok: false,
      skipped: true,
      message: `No unfulfilled matching Shopify line item found for ${order.orderNumber}.`,
      order,
    };
  }

  const mutation = await shopifyGraphql<{
    fulfillmentCreate?: {
      fulfillment?: { id?: string; status?: string; displayStatus?: string } | null;
      userErrors?: ShopifyUserError[];
    };
  }>(
    `
      mutation DispatchFulfillmentCreate($fulfillment: FulfillmentInput!, $message: String) {
        fulfillmentCreate(fulfillment: $fulfillment, message: $message) {
          fulfillment {
            id
            status
            displayStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      fulfillment: {
        notifyCustomer: false,
        lineItemsByFulfillmentOrder,
      },
      message: `Scheduled in Green Hills Dispatch (${reason}) for ticket ${order.orderNumber}.`,
    },
  );

  const userErrorMessage = shopifyUserErrorMessage(mutation.fulfillmentCreate?.userErrors);
  if (userErrorMessage) throw new Error(userErrorMessage);

  const fulfillment = mutation.fulfillmentCreate?.fulfillment;
  const fulfillmentId = fulfillment?.id || "";
  if (!fulfillmentId) throw new Error("Shopify did not return a fulfillment id.");

  const updatedOrder = await saveShopifyChecklist(order, {
    shopifyFulfillmentId: fulfillmentId,
    shopifyFulfillmentStatus: fulfillment.status || fulfillment.displayStatus || "FULFILLED",
    shopifyFulfilledAt: new Date().toISOString(),
  });

  return {
    ok: true,
    skipped: false,
    message: `Marked Shopify order ${checklist.shopifyOrderName || checklist.shopifyOrderId} fulfilled.`,
    order: updatedOrder,
    fulfillmentId,
  };
}

function gpsCoordinates(value?: string | null) {
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return match ? { latitude: Number(match[1]), longitude: Number(match[2]) } : null;
}

async function markShopifyDispatchOrderDelivered(order: DispatchOrder, happenedAt: string, input: { proofName: string; gpsLocation: string }) {
  let checklist = shopifyChecklist(order);
  let workingOrder = order;

  if (!checklist.shopifyOrderId) {
    return { ok: false, skipped: true, message: "No Shopify order id on dispatch ticket.", order };
  }

  if (!checklist.shopifyFulfillmentId) {
    const fulfilled = await fulfillShopifyDispatchOrder(order, "driver-delivered");
    workingOrder = fulfilled.order;
    checklist = shopifyChecklist(workingOrder);
  }

  if (!checklist.shopifyFulfillmentId) {
    return { ok: false, skipped: true, message: "No Shopify fulfillment id available to mark delivered.", order: workingOrder };
  }

  const coords = gpsCoordinates(input.gpsLocation);
  const fulfillmentEvent: Record<string, unknown> = {
    fulfillmentId: checklist.shopifyFulfillmentId,
    status: "DELIVERED",
    message: `Delivered by ${input.proofName || "driver"} from Green Hills Dispatch.`,
    happenedAt,
  };
  if (coords) {
    fulfillmentEvent.latitude = coords.latitude;
    fulfillmentEvent.longitude = coords.longitude;
  }

  const mutation = await shopifyGraphql<{
    fulfillmentEventCreate?: {
      fulfillmentEvent?: { id?: string; status?: string; message?: string } | null;
      userErrors?: ShopifyUserError[];
    };
  }>(
    `
      mutation DispatchFulfillmentEventCreate($fulfillmentEvent: FulfillmentEventInput!) {
        fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
          fulfillmentEvent {
            id
            status
            message
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { fulfillmentEvent },
  );

  const userErrorMessage = shopifyUserErrorMessage(mutation.fulfillmentEventCreate?.userErrors);
  if (userErrorMessage) throw new Error(userErrorMessage);

  const updatedOrder = await saveShopifyChecklist(workingOrder, {
    shopifyDeliveredAt: happenedAt,
    shopifyDeliveryEventId: mutation.fulfillmentEventCreate?.fulfillmentEvent?.id || "",
    shopifyFulfillmentStatus: "DELIVERED",
  });

  return {
    ok: true,
    skipped: false,
    message: `Marked Shopify fulfillment delivered for ${order.orderNumber}.`,
    order: updatedOrder,
  };
}

async function syncShopifyFulfilledForAssignedOrder(order: DispatchOrder, routeId: string, reason: string) {
  try {
    const result = await fulfillShopifyDispatchOrder(order, reason);
    await writeAuditLog({
      action: result.ok ? "shopify_mark_fulfilled" : "shopify_mark_fulfilled_skipped",
      actor: "shopify-sync",
      orderId: order.id,
      routeId,
      message: result.message,
      before: order,
      after: result.order,
    });
    return result.order;
  } catch (error) {
    await writeAuditLog({
      action: "shopify_mark_fulfilled_failed",
      actor: "shopify-sync",
      orderId: order.id,
      routeId,
      message: error instanceof Error ? error.message : "Shopify fulfilled sync failed.",
      before: order,
    });
    return order;
  }
}

async function fetchShopifyOrderBatch(limit: number, query: string, sortKey: "CREATED_AT" | "UPDATED_AT") {
  if (!SHOPIFY_SHOP_DOMAIN) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN.");
  }
  const accessToken = await getShopifyAccessToken();

  const response = await fetch(
    `https://${normalizeShopDomain(SHOPIFY_SHOP_DOMAIN)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `
          query DispatchOrders($first: Int!, $query: String!, $sortKey: OrderSortKeys!) {
            orders(first: $first, reverse: true, sortKey: $sortKey, query: $query) {
              nodes {
                id
                name
                legacyResourceId
                createdAt
                updatedAt
                cancelledAt
                displayFulfillmentStatus
                displayFinancialStatus
                note
                phone
                email
                customAttributes {
                  key
                  value
                }
                customer {
                  displayName
                  email
                  phone
                  defaultAddress {
                    phone
                  }
                }
                shippingAddress {
                  name
                  phone
                  address1
                  address2
                  city
                  provinceCode
                  zip
                }
                metafields(first: 20) {
                  nodes {
                    namespace
                    key
                    value
                  }
                }
                shippingLines(first: 5) {
                  nodes {
                    title
                  }
                }
                lineItems(first: 50) {
                  nodes {
                    id
                    title
                    name
                    sku
                    vendor
                    quantity
                    customAttributes {
                      key
                      value
                    }
                    variant {
                      id
                      title
                      sku
                      selectedOptions {
                        name
                        value
                      }
                      product {
                        handle
                        title
                        vendor
                        unitLabel: metafield(namespace: "green_hills", key: "price_unit_label") {
                          value
                        }
                        legacyUnitLabel: metafield(namespace: "$app", key: "price_unit_label") {
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        variables: { first: Math.max(1, Math.min(limit, 250)), query, sortKey },
      }),
    },
  );

  const body = await response.json() as {
    data?: { orders?: { nodes?: ShopifyOrderNode[] } };
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || body.errors?.length) {
    const message = body.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || `Shopify import failed with HTTP ${response.status}.`);
  }

  return body.data?.orders?.nodes || [];
}

function shopifyScanSummary(order: ShopifyOrderNode) {
  const fulfillmentStatus = String(order.displayFulfillmentStatus || "unknown").toLowerCase();
  const cancelled = order.cancelledAt ? "cancelled" : "active";
  const hasAddress = order.shippingAddress?.address1 ? "addr" : "no addr";
  const lineCount = order.lineItems?.nodes?.filter((lineItem) => lineItem?.name).length || 0;
  const createdDate = String(order.createdAt || "").slice(0, 10) || "no date";
  return `${order.name || order.id} ${createdDate} ${fulfillmentStatus} ${cancelled} ${hasAddress} ${lineCount} lines`;
}

function shopifyLineItemKey(order: ShopifyOrderNode, lineItem: ShopifyLineItem, index = 0) {
  return `shopify:${order.id}#${lineItem.id || lineItem.variant?.id || lineItem.sku || lineItem.title || lineItem.name || index}`;
}

function shouldSkipShopifyLineItem(lineItem: ShopifyLineItem) {
  const text = [lineItem.title, lineItem.name, lineItem.variant?.product?.title]
    .filter(Boolean)
    .join(" ");
  return /\b(delivery|shipping|tax|fee|discount|tip|gift card)\b/i.test(text);
}

async function fetchShopifyOrders(limit: number, sinceDays: number, mode: ShopifyImportMode = "sync") {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const sinceDate = since.toISOString().slice(0, 10);
  const batchLimit = Math.max(1, Math.min(limit, 250));
  const latestLimit = mode === "new"
    ? Math.max(100, Math.min(batchLimit, 250))
    : Math.max(25, Math.min(batchLimit, 100));

  // Shopify search can miss brand-new orders when a narrow status filter is applied.
  // Pull open and broad recent batches, then let our importer apply fulfillment/address
  // skip rules where we can record useful details. The final empty-query CREATED_AT
  // batch is an escape hatch for stores where Shopify search indexing lags.
  const createdBatchPromises = [
    fetchShopifyOrderBatch(batchLimit, `status:open created_at:>=${sinceDate}`, "CREATED_AT"),
    fetchShopifyOrderBatch(batchLimit, `created_at:>=${sinceDate}`, "CREATED_AT"),
    fetchShopifyOrderBatch(latestLimit, "", "CREATED_AT"),
  ] as const;
  const updateBatchPromises = [
    fetchShopifyOrderBatch(batchLimit, `status:open updated_at:>=${sinceDate}`, "UPDATED_AT"),
    fetchShopifyOrderBatch(batchLimit, `updated_at:>=${sinceDate}`, "UPDATED_AT"),
  ] as const;

  const [
    createdOrders,
    broadCreatedOrders,
    latestOrders,
    updatedOrders,
    broadUpdatedOrders,
  ] = mode === "new"
    ? [
        ...(await Promise.all(createdBatchPromises)),
        [] as ShopifyOrderNode[],
        [] as ShopifyOrderNode[],
      ]
    : [
        ...(await Promise.all(createdBatchPromises)),
        ...(await Promise.all(updateBatchPromises)),
      ];

  const byId = new Map<string, ShopifyOrderNode>();
  for (const order of [
    ...updatedOrders,
    ...createdOrders,
    ...broadUpdatedOrders,
    ...broadCreatedOrders,
    ...latestOrders,
  ]) {
    if (order?.id) byId.set(order.id, order);
  }

  const orders = Array.from(byId.values()).sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || "") || 0;
    const rightTime = Date.parse(right.updatedAt || right.createdAt || "") || 0;
    return rightTime - leftTime;
  });

  return {
    orders,
    details: [
      `Shopify scan counts: open-updated ${updatedOrders.length}, open-created ${createdOrders.length}, broad-updated ${broadUpdatedOrders.length}, broad-created ${broadCreatedOrders.length}, latest-created ${latestOrders.length}, unique ${orders.length}.`,
      `Shopify scan mode: ${mode}.`,
      `Latest Shopify scan: ${latestOrders.slice(0, 15).map(shopifyScanSummary).join("; ") || "none"}.`,
    ],
  };
}

async function findExistingDispatchOrder(orderNumber: string) {
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("order_number", orderNumber)
    .limit(1);

  if (error) throw new Error(formatSupabaseError(error));
  return data?.[0] ? normalizeOrder(data[0]) : null;
}

function normalizedShopifyMatchText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shopifyChecklistMatchesLineItem(
  row: any,
  input: {
    orderId: string;
    orderName: string;
    legacyResourceId: string;
    importKey: string;
    lineItemId: string;
    variantId: string;
    sku: string;
    material: string;
  },
) {
  const checklist = parseChecklist(row.checklist_json);
  const checklistOrderMatches = Boolean(
    (input.orderId && String(checklist.shopifyOrderId || "") === input.orderId) ||
      (input.orderName && String(checklist.shopifyOrderName || "") === input.orderName) ||
      (input.legacyResourceId && String(checklist.shopifyLegacyResourceId || "") === input.legacyResourceId),
  );

  if (
    input.importKey &&
    String(checklist.shopifyImportKey || "") === input.importKey
  ) {
    return true;
  }
  if (
    input.lineItemId &&
    String(checklist.shopifyLineItemId || "") === input.lineItemId
  ) {
    return true;
  }
  if (
    checklistOrderMatches &&
    input.variantId &&
    String(checklist.shopifyVariantId || "") === input.variantId
  ) {
    return true;
  }
  if (
    checklistOrderMatches &&
    input.sku &&
    normalizedShopifyMatchText(checklist.sku) === normalizedShopifyMatchText(input.sku)
  ) {
    return true;
  }
  if (checklistOrderMatches) {
    const existingMaterial = normalizedShopifyMatchText(row.material);
    const incomingMaterial = normalizedShopifyMatchText(input.material);
    return Boolean(
      existingMaterial &&
        incomingMaterial &&
        (existingMaterial === incomingMaterial ||
          existingMaterial.includes(incomingMaterial) ||
          incomingMaterial.includes(existingMaterial)),
    );
  }

  return false;
}

async function findExistingShopifyDispatchOrder(
  orderNumber: string,
  input: {
    orderId: string;
    orderName: string;
    legacyResourceId: string;
    importKey: string;
    lineItemId: string;
    variantId: string;
    sku: string;
    material: string;
  },
) {
  const existingByOrderNumber = await findExistingDispatchOrder(orderNumber);
  if (existingByOrderNumber) return existingByOrderNumber;

  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .or([
      `order_number.eq.${orderNumber}`,
      `order_number.eq.${input.orderName}`,
      `checklist_json.ilike.%${input.orderId}%`,
      `checklist_json.ilike.%${input.orderName}%`,
      input.legacyResourceId ? `checklist_json.ilike.%${input.legacyResourceId}%` : "",
      input.lineItemId ? `checklist_json.ilike.%${input.lineItemId}%` : "",
      input.variantId ? `checklist_json.ilike.%${input.variantId}%` : "",
      input.sku ? `checklist_json.ilike.%${input.sku}%` : "",
    ].filter(Boolean).join(","))
    .limit(250);

  if (error) throw new Error(formatSupabaseError(error));

  const match = (data || []).find((row) => shopifyChecklistMatchesLineItem(row, input));

  return match ? normalizeOrder(match) : null;
}

export async function importRecentShopifyOrders(
  input: {
    limit?: number;
    sinceDays?: number;
    calculateDistances?: boolean;
    distanceLimit?: number;
    mode?: ShopifyImportMode;
  } = {},
): Promise<ShopifyImportResult> {
  const limit = input.limit || 50;
  const sinceDays = input.sinceDays || 14;
  const mode = input.mode || "sync";
  const importOnly = mode === "new";
  const updateOnly = mode === "updates";
  const distanceLimit = Math.max(0, Math.min(Number(input.distanceLimit || 10), 25));
  const details: string[] = [];
  const distanceCandidates: string[] = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let distanceUpdated = 0;
  let distanceSkipped = 0;

  const shopifyFetch = await fetchShopifyOrders(limit, sinceDays, mode);
  const shopifyOrders = shopifyFetch.orders;
  details.push(...shopifyFetch.details);
  if (shopifyOrders.length) {
    details.push(
      `Fetched Shopify orders: ${shopifyOrders
        .slice(0, 20)
        .map((order) => order.name || order.id)
        .join(", ")}${shopifyOrders.length > 20 ? `, +${shopifyOrders.length - 20} more` : ""}.`,
    );
  } else {
    details.push(`Fetched 0 Shopify orders from the last ${sinceDays} days.`);
  }

  for (const shopifyOrder of shopifyOrders) {
    if (shopifyOrder.cancelledAt) {
      skipped += 1;
      details.push(`${shopifyOrder.name}: skipped because Shopify says cancelled.`);
      continue;
    }

    if (String(shopifyOrder.displayFulfillmentStatus || "").toUpperCase() === "FULFILLED") {
      skipped += 1;
      details.push(`${shopifyOrder.name}: skipped because Shopify says fulfilled.`);
      continue;
    }

    if (!shopifyOrder.shippingAddress?.address1) {
      skipped += 1;
      details.push(`${shopifyOrder.name}: skipped because it has no shipping address.`);
      continue;
    }

    const allLineItems = shopifyOrder.lineItems?.nodes?.filter((lineItem) => lineItem?.name || lineItem?.title) || [];
    const lineItems = allLineItems.filter(
      (lineItem) => !shouldSkipShopifyLineItem(lineItem) && Number(lineItem.quantity || 0) > 0,
    );
    if (!lineItems.length) {
      skipped += 1;
      details.push(`${shopifyOrder.name}: skipped because it has no shippable material line items.`);
      continue;
    }

    const baseOrderNumber = cleanOrderNumber(shopifyOrder.name);

    for (const [index, lineItem] of lineItems.entries()) {
      const orderNumber = `${baseOrderNumber}${suffixForIndex(index, lineItems.length)}`;
      const importKey = shopifyLineItemKey(shopifyOrder, lineItem, index);
      try {
        const resolvedMaterial = await resolveShopifyMaterialName(lineItem);
        const material = resolvedMaterial.material;
        const existingOrder = await findExistingShopifyDispatchOrder(orderNumber, {
          orderId: shopifyOrder.id,
          orderName: shopifyOrder.name,
          legacyResourceId: shopifyOrder.legacyResourceId || "",
          importKey,
          lineItemId: lineItem.id || "",
          variantId: lineItem.variant?.id || "",
          sku: lineItem.sku || lineItem.variant?.sku || "",
          material,
        });

        if (
          existingOrder?.status === "delivered" ||
          existingOrder?.deliveryStatus === "delivered" ||
          existingOrder?.status === "cancelled"
        ) {
          skipped += 1;
          details.push(`${orderNumber}: skipped because dispatch ticket is ${existingOrder.status}.`);
          continue;
        }

        const row = await buildShopifyDispatchRow(shopifyOrder, lineItem, orderNumber, importKey);

        if (existingOrder) {
          if (importOnly) {
            skipped += 1;
            details.push(`${orderNumber}: skipped because it already exists in dispatch.`);
            continue;
          }

          const existingNormalizedUnit = normalizeDispatchUnitLabel(existingOrder.unit);
          const rowNormalizedUnit = normalizeDispatchUnitLabel(row.unit);
          const nextUnit =
            rowNormalizedUnit === "Unit" && existingNormalizedUnit && existingNormalizedUnit !== "Unit"
              ? existingOrder.unit
              : row.unit;
          const nextShopifyChecklist = parseChecklist(row.checklist_json);
          const mergedChecklist = {
            ...parseChecklist(existingOrder.checklistJson),
            ...nextShopifyChecklist,
            importedFrom: "shopify",
          };
          const { data, error } = await supabase
            .from("dispatch_orders")
            .update({
              customer: row.customer,
              contact: row.contact,
              address: row.address,
              city: row.city,
              material: row.material,
              quantity: row.quantity,
              unit: nextUnit,
              requested_window: row.requested_window,
              time_preference: row.time_preference,
              proof_notes: row.proof_notes,
              checklist_json: JSON.stringify(mergedChecklist),
              updated_at: row.updated_at,
            })
            .eq("id", existingOrder.id)
            .select(ORDER_COLUMNS)
            .single();

          if (error) throw new Error(formatSupabaseError(error));
          updated += 1;
          const updatedOrder = normalizeOrder(data);
          await writeAuditLog({
            action: "shopify_update_order",
            actor: "shopify-import",
            orderId: updatedOrder.id,
            routeId: updatedOrder.assignedRouteId,
            message: `Updated Shopify order ${updatedOrder.orderNumber}.`,
            before: existingOrder,
            after: updatedOrder,
          });
          if (!updatedOrder.travelMinutes || !updatedOrder.travelMiles) {
            distanceCandidates.push(updatedOrder.id);
          }
          continue;
        }

        if (updateOnly) {
          skipped += 1;
          details.push(`${orderNumber}: skipped because it is not in dispatch yet.`);
          continue;
        }

        const { data, error } = await supabase
          .from("dispatch_orders")
          .insert(row)
          .select(ORDER_COLUMNS)
          .single();

        if (error) throw new Error(formatSupabaseError(error));
        imported += 1;
        const importedOrder = normalizeOrder(data);
        await writeAuditLog({
          action: "shopify_import_order",
          actor: "shopify-import",
          orderId: importedOrder.id,
          message: `Imported Shopify order ${importedOrder.orderNumber}.`,
          after: importedOrder,
        });
        distanceCandidates.push(importedOrder.id);
      } catch (error) {
        skipped += 1;
        details.push(`${orderNumber}: skipped - ${error instanceof Error ? error.message : "unknown import error"}`);
      }
    }
  }

  if (input.calculateDistances && distanceLimit > 0) {
    const candidates = Array.from(new Set(distanceCandidates)).slice(0, distanceLimit);
    if (distanceCandidates.length > distanceLimit) {
      details.push(`Distance calculation limited to ${distanceLimit} of ${distanceCandidates.length} imported/updated tickets.`);
    }

    for (const orderId of candidates) {
      try {
        const calculatedOrder = await calculateOrderDistance(orderId);
        distanceUpdated += 1;
        details.push(`${calculatedOrder.orderNumber}: calculated ${calculatedOrder.travelMinutes} min RT, ${calculatedOrder.travelMiles} mi.`);
      } catch (error) {
        distanceSkipped += 1;
        details.push(`${orderId}: distance skipped - ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  }

  const distanceMessage = input.calculateDistances
    ? ` ${distanceUpdated} route times calculated, ${distanceSkipped} distance skips.`
    : "";
  const modeLabel =
    mode === "new" ? "new order import" : mode === "updates" ? "order update" : "Shopify import";
  const message = `Shopify ${modeLabel} complete: ${imported} imported, ${updated} updated, ${skipped} skipped from ${shopifyOrders.length} orders fetched.${distanceMessage}`;
  await writeAuditLog({
    action: "shopify_import_complete",
    actor: "shopify-import",
    message,
    after: {
      imported,
      updated,
      skipped,
      distanceUpdated,
      distanceSkipped,
      fetched: shopifyOrders.length,
      sinceDays,
      limit,
      mode,
    },
  });

  return { ok: true, mode, imported, updated, skipped, distanceUpdated, distanceSkipped, message, details };
}

export async function createDispatchOrder(input: CreateDispatchOrderInput) {
  const now = new Date().toISOString();
  const orderId = makeDispatchId("D");
  const orderNumber = input.orderNumber?.trim() || makeManualOrderNumber();
  const { data, error } = await supabase
    .from("dispatch_orders")
    .insert({
      id: orderId,
      order_number: orderNumber,
      source: "manual",
      customer: input.customer.trim(),
      contact: input.contact?.trim() || null,
      address: input.address.trim(),
      city: input.city.trim(),
      material: input.material.trim(),
      quantity: input.quantity.trim(),
      unit: input.unit.trim() || "Unit",
      requested_window: input.requestedWindow?.trim() || null,
      time_preference: input.timePreference?.trim() || "Anytime",
      proof_notes: input.notes?.trim() || null,
      status: "new",
      delivery_status: "not_started",
      created_at: now,
      updated_at: now,
    })
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const order = normalizeOrder(data);
  await writeAuditLog({
    action: "create_order",
    actor: "dispatcher",
    orderId: order.id,
    message: `Created manual order ${order.orderNumber}.`,
    after: order,
  });
  return order;
}

export async function createDispatchRoute(input: CreateDispatchRouteInput) {
  const now = new Date().toISOString();
  const routeId = makeDispatchId("R");
  const truck = await resolveDispatchTruckForRoute(input.truckId, input.truck);
  const { data, error } = await supabase
    .from("dispatch_routes")
    .insert({
      id: routeId,
      code: input.code.trim(),
      truck_id: truck?.id || input.truckId || null,
      truck: input.truck?.trim() || "",
      driver: input.driver?.trim() || "",
      helper: input.helper?.trim() || "",
      color: input.color?.trim() || "#38bdf8",
      shift: input.shift?.trim() || "",
      region: input.region?.trim() || "",
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    .select(ROUTE_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const route = normalizeRoute(data);
  await writeAuditLog({
    action: "create_route",
    actor: "dispatcher",
    routeId: route.id,
    message: `Created route ${route.code}.`,
    after: route,
  });
  return route;
}

export async function updateDispatchOrder(orderId: string, input: UpdateDispatchOrderInput) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeOrder(beforeData);
  const now = new Date().toISOString();
  const status = input.status || before.status;
  const isMarkingDelivered = status === "delivered" && before.status !== "delivered";
  const isReopeningDelivered = status !== "delivered" && before.status === "delivered";
  const deliveryStatus =
    status === "delivered"
      ? "delivered"
      : status === "cancelled"
        ? before.deliveryStatus
        : before.deliveryStatus === "delivered"
          ? "not_started"
          : before.deliveryStatus;

  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      order_number: input.orderNumber.trim() || before.orderNumber,
      customer: input.customer.trim(),
      contact: input.contact?.trim() || null,
      address: input.address.trim(),
      city: input.city.trim(),
      material: input.material.trim(),
      quantity: input.quantity.trim(),
      unit: input.unit.trim() || "Unit",
      requested_window: input.requestedWindow?.trim() || null,
      time_preference: input.timePreference?.trim() || "Anytime",
      delivered_at: status === "delivered" ? before.deliveredAt || now : isReopeningDelivered ? null : before.deliveredAt,
      proof_name: status === "delivered" ? before.proofName || "Dispatcher" : isReopeningDelivered ? null : before.proofName,
      proof_notes: input.notes === undefined ? before.proofNotes : input.notes.trim() || null,
      status,
      delivery_status: deliveryStatus,
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  let updatedOrder = normalizeOrder(data);
  let shopifyResult: { ok: boolean; skipped: boolean; message: string } | null = null;
  if (isMarkingDelivered) {
    try {
      const result = await markShopifyDispatchOrderDelivered(updatedOrder, updatedOrder.deliveredAt || now, {
        proofName: updatedOrder.proofName || "Dispatcher",
        gpsLocation: updatedOrder.signatureData || "",
      });
      updatedOrder = result.order;
      shopifyResult = { ok: result.ok, skipped: result.skipped, message: result.message };
    } catch (error) {
      shopifyResult = {
        ok: false,
        skipped: false,
        message: error instanceof Error ? error.message : "Shopify delivered sync failed.",
      };
    }
  }
  await writeAuditLog({
    action: "update_order",
    actor: "dispatcher",
    orderId,
    routeId: updatedOrder.assignedRouteId,
    message: isMarkingDelivered
      ? `Marked order ${updatedOrder.orderNumber} delivered from the Orders screen. Shopify: ${shopifyResult?.message || "not attempted"}.`
      : `Updated order ${updatedOrder.orderNumber}.`,
    before,
    after: shopifyResult ? { ...updatedOrder, shopifySync: shopifyResult } : updatedOrder,
  });
  return updatedOrder;
}

export async function saveDriverOrderAttachment(
  orderId: string,
  input: { dataUrl: string; name?: string; note?: string },
) {
  if (!/^data:image\//i.test(input.dataUrl) && !/^https?:\/\//i.test(input.dataUrl)) {
    throw new Error("Attach an image file for the driver.");
  }

  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeOrder(beforeData);
  const now = new Date().toISOString();
  const uploadedPhoto = await uploadDispatchPhoto(
    input.dataUrl,
    `order-attachments/${orderId}`,
    input.name || "driver-order-photo",
  );
  const checklist = {
    ...parseChecklist(before.checklistJson),
    driverAttachment: {
      dataUrl: uploadedPhoto.url,
      url: uploadedPhoto.url,
      storageBucket: DISPATCH_PHOTO_BUCKET,
      storagePath: uploadedPhoto.path,
      mimeType: uploadedPhoto.mimeType,
      size: uploadedPhoto.size,
      name: input.name?.trim() || "Driver order photo",
      note: input.note?.trim() || "",
      attachedAt: now,
    },
  };

  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      checklist_json: JSON.stringify(checklist),
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedOrder = normalizeOrder(data);
  await writeAuditLog({
    action: "driver_order_attachment_save",
    actor: "dispatcher",
    orderId,
    routeId: updatedOrder.assignedRouteId,
    message: `Saved driver-visible photo for order ${updatedOrder.orderNumber}.`,
    before,
    after: updatedOrder,
  });
  return updatedOrder;
}

export async function clearDriverOrderAttachment(orderId: string) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeOrder(beforeData);
  const now = new Date().toISOString();
  const checklist = { ...parseChecklist(before.checklistJson) };
  delete checklist.driverAttachment;

  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      checklist_json: JSON.stringify(checklist),
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedOrder = normalizeOrder(data);
  await writeAuditLog({
    action: "driver_order_attachment_clear",
    actor: "dispatcher",
    orderId,
    routeId: updatedOrder.assignedRouteId,
    message: `Removed driver-visible photo for order ${updatedOrder.orderNumber}.`,
    before,
    after: updatedOrder,
  });
  return updatedOrder;
}

export async function cancelDispatchOrder(orderId: string) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeOrder(beforeData);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      status: "cancelled",
      assigned_route_id: null,
      stop_sequence: null,
      eta: null,
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedOrder = normalizeOrder(data);
  await writeAuditLog({
    action: "cancel_order",
    actor: "dispatcher",
    orderId,
    routeId: before.assignedRouteId,
    message: `Cancelled order ${updatedOrder.orderNumber}.`,
    before,
    after: updatedOrder,
  });
  return updatedOrder;
}

export async function reopenDispatchOrder(orderId: string) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeOrder(beforeData);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      status: "new",
      delivery_status: "not_started",
      delivered_at: null,
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedOrder = normalizeOrder(data);
  await writeAuditLog({
    action: "reopen_order",
    actor: "dispatcher",
    orderId,
    routeId: updatedOrder.assignedRouteId,
    message: `Reopened order ${updatedOrder.orderNumber}.`,
    before,
    after: updatedOrder,
  });
  return updatedOrder;
}

export async function markDeliveredOrderUndelivered(orderId: string) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeOrder(beforeData);
  const now = new Date().toISOString();
  const nextStatus = before.assignedRouteId ? "scheduled" : "new";
  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      status: nextStatus,
      delivery_status: "not_started",
      departed_at: null,
      delivered_at: null,
      proof_name: null,
      proof_notes: null,
      signature_data: null,
      photo_urls: null,
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedOrder = normalizeOrder(data);
  await writeAuditLog({
    action: "mark_undelivered",
    actor: "dispatcher",
    orderId,
    routeId: before.assignedRouteId,
    message:
      nextStatus === "scheduled"
        ? `${updatedOrder.orderNumber} marked undelivered and returned to its route.`
        : `${updatedOrder.orderNumber} marked undelivered and returned to the queue.`,
    before,
    after: updatedOrder,
  });
  return updatedOrder;
}

export async function deleteDispatchOrder(orderId: string) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeOrder(beforeData);
  const { error } = await supabase
    .from("dispatch_orders")
    .delete()
    .eq("id", orderId);

  if (error) throw new Error(formatSupabaseError(error));
  await writeAuditLog({
    action: "delete_order",
    actor: "dispatcher",
    orderId,
    routeId: before.assignedRouteId,
    message: `Deleted order ${before.orderNumber}.`,
    before,
  });
  return before;
}

export async function updateDispatchRoute(routeId: string, input: UpdateDispatchRouteInput) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_routes")
    .select(ROUTE_COLUMNS)
    .eq("id", routeId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeRoute(beforeData);
  const now = new Date().toISOString();
  const truck = await resolveDispatchTruckForRoute(input.truckId, input.truck);
  const { data, error } = await supabase
    .from("dispatch_routes")
    .update({
      code: input.code.trim() || before.code,
      truck_id: truck?.id || input.truckId || null,
      truck: input.truck?.trim() || "",
      driver_id: input.driverId || null,
      driver: input.driver?.trim() || "",
      helper_id: input.helperId || null,
      helper: input.helper?.trim() || "",
      color: input.color?.trim() || before.color || "#38bdf8",
      shift: input.shift?.trim() || "",
      region: input.region?.trim() || "",
      is_active: input.isActive,
      updated_at: now,
    })
    .eq("id", routeId)
    .select(ROUTE_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedRoute = normalizeRoute(data);
  await writeAuditLog({
    action: "update_route",
    actor: "dispatcher",
    routeId,
    message: `Updated route ${updatedRoute.code}.`,
    before,
    after: updatedRoute,
  });
  return updatedRoute;
}

export async function deactivateDispatchRoute(routeId: string) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_routes")
    .select(ROUTE_COLUMNS)
    .eq("id", routeId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeRoute(beforeData);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dispatch_routes")
    .update({
      is_active: false,
      updated_at: now,
    })
    .eq("id", routeId)
    .select(ROUTE_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedRoute = normalizeRoute(data);
  await writeAuditLog({
    action: "deactivate_route",
    actor: "dispatcher",
    routeId,
    message: `Deactivated route ${updatedRoute.code}.`,
    before,
    after: updatedRoute,
  });
  return updatedRoute;
}

export async function reactivateDispatchRoute(routeId: string) {
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_routes")
    .select(ROUTE_COLUMNS)
    .eq("id", routeId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeRoute(beforeData);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dispatch_routes")
    .update({
      is_active: true,
      updated_at: now,
    })
    .eq("id", routeId)
    .select(ROUTE_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedRoute = normalizeRoute(data);
  await writeAuditLog({
    action: "reactivate_route",
    actor: "dispatcher",
    routeId,
    message: `Reactivated route ${updatedRoute.code}.`,
    before,
    after: updatedRoute,
  });
  return updatedRoute;
}

async function getNextStopSequence(routeId: string) {
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select("stop_sequence")
    .eq("assigned_route_id", routeId)
    .not("status", "in", "(delivered,cancelled)")
    .order("stop_sequence", { ascending: false })
    .limit(1);

  if (error) throw new Error(formatSupabaseError(error));
  return Number(data?.[0]?.stop_sequence || 0) + 1;
}

async function resequenceRoute(routeId?: string | null) {
  if (!routeId) return;

  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("assigned_route_id", routeId)
    .not("status", "in", "(delivered,cancelled)")
    .or("delivery_status.is.null,delivery_status.neq.delivered")
    .order("stop_sequence", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(formatSupabaseError(error));

  const stops = (data || []).map(normalizeOrder).sort(sortStops);
  const updates = stops
    .map((order, index) => ({ order, nextSequence: index + 1 }))
    .filter(({ order, nextSequence }) => Number(order.stopSequence || 0) !== nextSequence)
    .map(({ order, nextSequence }) =>
      supabase
        .from("dispatch_orders")
        .update({
          stop_sequence: nextSequence,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id),
    );

  if (!updates.length) return;
  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(formatSupabaseError(failed.error));
}

async function resequenceRoutes(routeIds: Array<string | null | undefined>) {
  const uniqueRouteIds = Array.from(new Set(routeIds.filter((routeId): routeId is string => Boolean(routeId))));
  await Promise.all(uniqueRouteIds.map((routeId) => resequenceRoute(routeId)));
}

function numericValue(value?: string | number | null) {
  const direct = Number(value || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function orderQuantity(order: DispatchOrder) {
  return numericValue(order.quantity);
}

function truckCapacityUnit(unit: string) {
  if (/tons?/i.test(unit)) return "tons";
  if (/yards?/i.test(unit)) return "yards";
  return "";
}

function routeTruckCapacity(route: DispatchRoute | null, unit: string) {
  const capacityUnit = truckCapacityUnit(unit);
  if (!capacityUnit) return 0;

  const fleetCapacity = capacityUnit === "tons" ? route?.truckTonCapacity : route?.truckYardCapacity;
  if (fleetCapacity && fleetCapacity > 0) return fleetCapacity;

  const truckLabel = route?.truck || "";
  const unitRegex = capacityUnit === "tons"
    ? /(\d+(?:\.\d+)?)\s*(?:ton|tons)\b/i
    : /(\d+(?:\.\d+)?)\s*(?:yard|yards|yd|yds)\b/i;
  const explicit = truckLabel.match(unitRegex)?.[1];
  if (explicit) return Number(explicit);

  return capacityUnit === "tons" ? DEFAULT_TRUCK_TON_CAPACITY : DEFAULT_TRUCK_YARD_CAPACITY;
}

function splitSuffix(index: number) {
  let value = index;
  let suffix = "";
  do {
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return suffix;
}

function splitBaseOrderNumber(order: DispatchOrder) {
  const base = String(order.orderNumber || order.id.replace(/^D-/, "")).trim();
  return base.replace(/[a-z]$/i, "");
}

function formatSplitQuantity(value: number) {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function splitCapacityError(order: DispatchOrder, route: DispatchRoute | null, splitCount: number) {
  const unitLabel = truckCapacityUnit(order.unit);
  if (!unitLabel) return "";
  if (!route?.truck?.trim()) return "This route needs a truck number before assigning ton or yard loads.";

  const quantity = orderQuantity(order);
  const capacity = routeTruckCapacity(route, order.unit);
  if (!quantity || !capacity || quantity <= capacity) return "";
  if (splitCount < 2) {
    return `${order.customer || order.orderNumber} needs ${formatSplitQuantity(quantity)} ${unitLabel}, which is over ${route.truck}'s ${formatSplitQuantity(capacity)} ${unitLabel} limit. Split the order before assigning it.`;
  }

  const perLoad = quantity / splitCount;
  if (perLoad > capacity) {
    return `${splitCount} split tickets would still be ${formatSplitQuantity(perLoad)} ${unitLabel} each. Use at least ${Math.ceil(quantity / capacity)} split tickets for ${route.truck}.`;
  }

  return "";
}

export async function assignOrder(orderId: string, routeId: string, splitCount = 0): Promise<AssignOrderResult> {
  const nextSequence = await getNextStopSequence(routeId);
  const assignedRoute = await getDispatchRouteById(routeId);
  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const beforeOrder = normalizeOrder(beforeData);
  const requestedSplitCount = Math.floor(Number(splitCount || 0));
  const capacityError = splitCapacityError(beforeOrder, assignedRoute, requestedSplitCount);
  if (capacityError) throw new Error(capacityError);

  const quantity = orderQuantity(beforeOrder);
  const capacity = routeTruckCapacity(assignedRoute, beforeOrder.unit);
  const shouldSplit =
    Boolean(truckCapacityUnit(beforeOrder.unit)) &&
    capacity > 0 &&
    quantity > capacity &&
    requestedSplitCount > 1;

  if (shouldSplit) {
    const perLoadQuantity = formatSplitQuantity(quantity / requestedSplitCount);
    const baseOrderNumber = splitBaseOrderNumber(beforeOrder);
    const splitNote = `Split from #${baseOrderNumber} into ${requestedSplitCount} loads.`;
    const checklist = {
      ...parseChecklist(beforeOrder.checklistJson),
      splitLoad: {
        baseOrderNumber,
        splitCount: requestedSplitCount,
        splitNote,
        splitAt: new Date().toISOString(),
      },
    };
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("dispatch_orders")
      .update({
        order_number: `${baseOrderNumber}${splitSuffix(0)}`,
        quantity: perLoadQuantity,
        assigned_route_id: routeId,
        stop_sequence: nextSequence,
        status: "scheduled",
        delivery_status: "not_started",
        checklist_json: JSON.stringify(checklist),
        updated_at: now,
      })
      .eq("id", orderId)
      .select(ORDER_COLUMNS)
      .single();

    if (error) throw new Error(formatSupabaseError(error));
    let updatedOrder = normalizeOrder(data);
    updatedOrder = await refreshStoredTimingForAssignedDriver(updatedOrder, assignedRoute);
    updatedOrder = await syncShopifyFulfilledForAssignedOrder(updatedOrder, routeId, "split-route-assignment");

    const createdOrders: DispatchOrder[] = [];
    for (let index = 1; index < requestedSplitCount; index += 1) {
      const createdId = makeDispatchId("D");
      const { data: createdData, error: createdError } = await supabase
        .from("dispatch_orders")
        .insert({
          id: createdId,
          order_number: `${baseOrderNumber}${splitSuffix(index)}`,
          source: beforeData.source || "manual",
          customer: beforeOrder.customer,
          contact: beforeOrder.contact || null,
          address: beforeOrder.address,
          city: beforeOrder.city,
          material: beforeOrder.material,
          quantity: perLoadQuantity,
          unit: beforeOrder.unit || "Unit",
          requested_window: beforeOrder.requestedWindow || null,
          time_preference: beforeOrder.timePreference || "Anytime",
          assigned_route_id: routeId,
          stop_sequence: nextSequence + index,
          status: "scheduled",
          delivery_status: "not_started",
          travel_minutes: beforeOrder.travelMinutes,
          travel_miles: beforeOrder.travelMiles,
          checklist_json: JSON.stringify(checklist),
          created_at: now,
          updated_at: now,
        })
        .select(ORDER_COLUMNS)
        .single();

      if (createdError) throw new Error(formatSupabaseError(createdError));
      let createdOrder = await refreshStoredTimingForAssignedDriver(normalizeOrder(createdData), assignedRoute);
      createdOrder = await syncShopifyFulfilledForAssignedOrder(createdOrder, routeId, "split-route-assignment");
      createdOrders.push(createdOrder);
    }

    const previousRouteId = beforeOrder.assignedRouteId;
    await resequenceRoutes([previousRouteId, routeId]);
    await writeAuditLog({
      action: "split_assign_order",
      actor: "dispatcher",
      orderId,
      routeId,
      message: `Split #${baseOrderNumber} into ${requestedSplitCount} route tickets for ${assignedRoute?.code || routeId}.`,
      before: beforeOrder,
      after: { updatedOrder, createdOrders },
    });

    return {
      ok: true,
      message: `Split #${baseOrderNumber} into ${requestedSplitCount} route tickets.`,
      updatedOrder,
      createdOrders,
      createdCount: requestedSplitCount,
    };
  }

  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      assigned_route_id: routeId,
      stop_sequence: nextSequence,
      status: "scheduled",
      delivery_status: "not_started",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  let updatedOrder = normalizeOrder(data);
  updatedOrder = await refreshStoredTimingForAssignedDriver(updatedOrder, assignedRoute);
  updatedOrder = await syncShopifyFulfilledForAssignedOrder(updatedOrder, routeId, "route-assignment");
  const previousRouteId = beforeOrder.assignedRouteId;
  await resequenceRoutes([previousRouteId, routeId]);
  await writeAuditLog({
    action: "assign_order",
    actor: "dispatcher",
    orderId,
    routeId,
    message: `Assigned ${updatedOrder.orderNumber} to route ${routeId}.`,
    before: beforeOrder,
    after: updatedOrder,
  });
  return {
    ok: true,
    message: "Assigned.",
    updatedOrder,
    createdOrders: [],
    createdCount: 1,
  };
}

export async function unassignOrder(orderId: string) {
  const { data: beforeData } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();
  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      assigned_route_id: null,
      stop_sequence: null,
      status: "new",
      delivery_status: "not_started",
      eta: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedOrder = normalizeOrder(data);
  const previousRouteId = beforeData ? normalizeOrder(beforeData).assignedRouteId : null;
  await resequenceRoute(previousRouteId);
  await writeAuditLog({
    action: "unassign_order",
    actor: "dispatcher",
    orderId,
    routeId: previousRouteId,
    message: `Moved ${updatedOrder.orderNumber} back to queue.`,
    before: beforeData ? normalizeOrder(beforeData) : null,
    after: updatedOrder,
  });
  return updatedOrder;
}

export async function reorderStop(orderId: string, direction: "up" | "down") {
  const { data: targetData, error: targetError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (targetError) throw new Error(formatSupabaseError(targetError));
  const target = normalizeOrder(targetData);
  if (!target.assignedRouteId) {
    return { moved: target, routeId: null, routeOrders: [] };
  }

  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("assigned_route_id", target.assignedRouteId)
    .not("status", "in", "(delivered,cancelled)")
    .order("stop_sequence", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(formatSupabaseError(error));

  const stops = (data || []).map(normalizeOrder).sort(sortStops);
  const index = stops.findIndex((order) => order.id === orderId);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= stops.length) {
    return { moved: target, routeId: target.assignedRouteId, routeOrders: stops };
  }

  const reordered = [...stops];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);

  const updates = reordered.map((order, orderIndex) =>
    supabase
      .from("dispatch_orders")
      .update({
        stop_sequence: orderIndex + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(formatSupabaseError(failed.error));

  await writeAuditLog({
    action: "reorder_stop",
    actor: "dispatcher",
    orderId,
    routeId: target.assignedRouteId,
    message: `Moved ${target.orderNumber} ${direction}.`,
    before: stops,
    after: reordered.map((order, orderIndex) => ({ ...order, stopSequence: orderIndex + 1 })),
  });

  return {
    moved: { ...moved, stopSequence: nextIndex + 1 },
    routeId: target.assignedRouteId,
    routeOrders: resequenceLocalOrdersForServer(reordered),
  };
}

export async function markStopEnroute(orderId: string, loadedQuantity: string) {
  const { data: existingData, error: existingError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (existingError) throw new Error(formatSupabaseError(existingError));
  const existing = normalizeOrder(existingData);
  const now = new Date().toISOString();
  const checklist = {
    ...parseChecklist(existing.checklistJson),
    loadedQuantity,
    loadedAt: now,
  };

  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      delivery_status: "en_route",
      departed_at: now,
      eta: getEnrouteEta(existing, now),
      checklist_json: JSON.stringify(checklist),
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  let updatedOrder = normalizeOrder(data);
  const route = await getDispatchRouteById(updatedOrder.assignedRouteId);
  const metric = await recordDispatchStopMetric({
    order: updatedOrder,
    route,
    event: "enroute",
    happenedAt: now,
  });
  await writeAuditLog({
    action: "mark_enroute",
    actor: "driver",
    orderId,
    routeId: updatedOrder.assignedRouteId,
    message: `${updatedOrder.orderNumber} marked enroute with ${loadedQuantity} loaded.${
      metric ? " Timing baseline captured." : ""
    }`,
    before: existing,
    after: { ...updatedOrder, timingMetric: metric },
  });
  return updatedOrder;
}

export async function markStopDelivered(
  orderId: string,
  input: { proofName: string; proofNotes: string; gpsLocation: string; photoUrls: string },
) {
  const { data: beforeData } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();
  const now = new Date().toISOString();
  const deliveredInput = {
    ...input,
    photoUrls: input.photoUrls,
  };
  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      status: "delivered",
      delivery_status: "delivered",
      delivered_at: now,
      proof_name: input.proofName || null,
      proof_notes: input.proofNotes || null,
      signature_data: input.gpsLocation || null,
      photo_urls: deliveredInput.photoUrls || null,
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedOrder = normalizeOrder(data);

  void finalizeStopDeliveredInBackground({
    beforeData,
    orderId,
    initialOrder: updatedOrder,
    input: deliveredInput,
    now,
  }).catch((error) => {
    console.warn("[dispatch-v2 delivered follow-up failed]", error instanceof Error ? error.message : error);
  });

  return updatedOrder;
}

async function finalizeStopDeliveredInBackground(input: {
  beforeData: any;
  orderId: string;
  initialOrder: DispatchOrder;
  input: { proofName: string; proofNotes: string; gpsLocation: string; photoUrls: string };
  now: string;
}) {
  let updatedOrder = input.initialOrder;
  let finalizedInput = input.input;
  let photoMessage = "Photo proof saved on the order.";

  try {
    const uploadedPhoto = input.input.photoUrls
      ? await uploadDispatchPhoto(input.input.photoUrls, `delivery-proof/${input.orderId}`, `delivery-proof-${input.orderId}`)
      : null;

    if (uploadedPhoto?.url && uploadedPhoto.url !== input.input.photoUrls) {
      const { data, error } = await supabase
        .from("dispatch_orders")
        .update({
          photo_urls: uploadedPhoto.url,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.orderId)
        .select(ORDER_COLUMNS)
        .single();

      if (error) {
        photoMessage = `Photo uploaded, but order photo URL update failed: ${formatSupabaseError(error)}`;
      } else {
        updatedOrder = normalizeOrder(data);
        finalizedInput = { ...input.input, photoUrls: uploadedPhoto.url };
        photoMessage = "Photo proof uploaded to storage.";
      }
    }
  } catch (error) {
    photoMessage = error instanceof Error ? error.message : "Photo upload failed; inline proof remains saved on the order.";
  }

  const route = await getDispatchRouteById(updatedOrder.assignedRouteId).catch(() => null);
  const metric = await recordDispatchStopMetric({
    order: updatedOrder,
    route,
    event: "delivered",
    happenedAt: input.now,
  }).catch((error) => {
    console.warn("[dispatch-v2 delivered timing skipped]", error instanceof Error ? error.message : error);
    return null;
  });

  let emailResult: { sent: boolean; message: string };
  try {
    emailResult = await sendDeliveryConfirmationEmail(updatedOrder, route, finalizedInput);
  } catch (error) {
    emailResult = {
      sent: false,
      message: error instanceof Error ? error.message : "Delivery email failed.",
    };
  }
  let shopifyResult: { ok: boolean; skipped: boolean; message: string };
  try {
    const result = await markShopifyDispatchOrderDelivered(updatedOrder, input.now, {
      proofName: input.input.proofName,
      gpsLocation: input.input.gpsLocation,
    });
    updatedOrder = result.order;
    shopifyResult = { ok: result.ok, skipped: result.skipped, message: result.message };
  } catch (error) {
    shopifyResult = {
      ok: false,
      skipped: false,
      message: error instanceof Error ? error.message : "Shopify delivered sync failed.",
    };
  }
  await writeAuditLog({
    action: "mark_delivered",
    actor: "driver",
    orderId: input.orderId,
    routeId: updatedOrder.assignedRouteId,
    message: `${updatedOrder.orderNumber} delivered by ${input.input.proofName}.${
      metric?.actualDriveMinutes ? ` Actual drive time: ${metric.actualDriveMinutes} min.` : ""
    } ${photoMessage} ${emailResult.message} Shopify: ${shopifyResult.message}`,
    before: input.beforeData ? normalizeOrder(input.beforeData) : null,
    after: {
      ...updatedOrder,
      photoUrls: updatedOrder.photoUrls ? "[captured]" : null,
      timingMetric: metric,
      deliveryEmail: emailResult,
      shopifySync: shopifyResult,
    },
  });
}

export async function resendDeliveryConfirmation(orderId: string) {
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const order = normalizeOrder(data);
  const route = await getDispatchRouteById(order.assignedRouteId);
  const input = {
    proofName: order.proofName || route?.driver || "Driver",
    proofNotes: order.proofNotes || "",
    gpsLocation: order.signatureData || "",
    photoUrls: order.photoUrls || "",
  };

  const emailResult = await sendDeliveryConfirmationEmail(order, route, input);
  await writeAuditLog({
    action: "resend_delivery_email",
    actor: "dispatcher",
    orderId,
    routeId: order.assignedRouteId,
    message: `${order.orderNumber} delivery confirmation resend: ${emailResult.message}`,
    after: { order, deliveryEmail: emailResult },
  });
  return emailResult;
}

export async function addDeliveredOrderPhoto(orderId: string, input: { dataUrl: string; name?: string }) {
  if (!String(input.dataUrl || "").trim()) {
    throw new Error("Choose a delivery proof photo before saving.");
  }
  if (!/^data:image\//i.test(input.dataUrl) && !/^https?:\/\//i.test(input.dataUrl)) {
    throw new Error("Attach an image file for the delivered order.");
  }

  const { data: beforeData, error: beforeError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (beforeError) throw new Error(formatSupabaseError(beforeError));
  const before = normalizeOrder(beforeData);
  const uploadedPhoto = await uploadDispatchPhoto(
    input.dataUrl,
    `delivery-proof/${orderId}`,
    input.name || `manual-delivery-proof-${before.orderNumber || orderId}`,
  );
  const existingPhotos = deliveryPhotoList(before.photoUrls);
  const photoUrls = existingPhotos.length
    ? JSON.stringify([...existingPhotos, uploadedPhoto.url])
    : uploadedPhoto.url;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      photo_urls: photoUrls,
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedOrder = normalizeOrder(data);
  await writeAuditLog({
    action: "delivered_photo_add",
    actor: "dispatcher",
    orderId,
    routeId: updatedOrder.assignedRouteId,
    message: `Added manual delivery proof photo for order ${updatedOrder.orderNumber}.`,
    before: { ...before, photoUrls: before.photoUrls ? "[captured]" : null },
    after: {
      ...updatedOrder,
      addedPhoto: {
        storageBucket: DISPATCH_PHOTO_BUCKET,
        storagePath: uploadedPhoto.path,
        mimeType: uploadedPhoto.mimeType,
        size: uploadedPhoto.size,
      },
      photoUrls: updatedOrder.photoUrls ? "[captured]" : null,
    },
  });
  return updatedOrder;
}

export async function markLoadPrepared(orderId: string, loaderNote: string) {
  const { data: existingData, error: existingError } = await supabase
    .from("dispatch_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();

  if (existingError) throw new Error(formatSupabaseError(existingError));
  const existing = normalizeOrder(existingData);
  const now = new Date().toISOString();
  const checklist = {
    ...parseChecklist(existing.checklistJson),
    loaderPreparedAt: now,
    loaderNote,
  };

  const { data, error } = await supabase
    .from("dispatch_orders")
    .update({
      checklist_json: JSON.stringify(checklist),
      updated_at: now,
    })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const updatedOrder = normalizeOrder(data);
  await writeAuditLog({
    action: "mark_load_prepared",
    actor: "loader",
    orderId,
    routeId: updatedOrder.assignedRouteId,
    message: `${updatedOrder.orderNumber} load prepared.${loaderNote ? ` Note: ${loaderNote}` : ""}`,
    before: existing,
    after: updatedOrder,
  });
  return updatedOrder;
}
