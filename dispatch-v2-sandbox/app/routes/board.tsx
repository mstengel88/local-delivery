import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import {
  data,
  Form,
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  useRevalidator,
} from "react-router";
import {
  assignOrder,
  calculateBoardDistances,
  createDispatchOrder,
  createDispatchRoute,
  getDispatchTimingInsights,
  getTimingMatchForOrder,
  getMapsConfigStatus,
  loadDispatchOperationalSettings,
  loadBoardState,
  parseDispatchLineItemsText,
  reorderStop,
  unassignOrder,
  type DistanceCalculationResult,
  type DispatchBoardState,
  type DispatchOrder,
  type DispatchTimingMatch,
} from "../lib/dispatch.server";
import { requireDispatchEditor, requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";
import { useDispatchVersionRevalidator } from "../components/useDispatchVersionRevalidator";

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

function shiftDateKey(dateKey: string | null, offsetDays: number) {
  const baseDate = dateKey ? new Date(`${dateKey}T12:00:00`) : new Date();
  if (Number.isNaN(baseDate.getTime())) return todayDateKey();
  baseDate.setDate(baseDate.getDate() + offsetDays);
  const year = baseDate.getFullYear();
  const month = String(baseDate.getMonth() + 1).padStart(2, "0");
  const day = String(baseDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function boardDateHref(dateKey: string | null, includeUndated: boolean) {
  const params = new URLSearchParams();
  if (dateKey) params.set("date", dateKey);
  else params.set("date", "all");
  if (!includeUndated) params.set("includeUndated", "0");
  return `?${params.toString()}`;
}

function defaultIncludeUndatedForDate(dateKey: string | null, requestedValue: string | null, url: URL) {
  const explicitIncludeUndated = url.searchParams.get("includeUndated");
  if (explicitIncludeUndated !== null) return explicitIncludeUndated === "1";
  if (!dateKey || requestedValue === "all") return true;
  return dateKey === todayDateKey();
}

function includeUndatedForTargetDate(dateKey: string | null, currentIncludeUndated: boolean) {
  if (!dateKey) return currentIncludeUndated;
  return dateKey === todayDateKey() ? currentIncludeUndated : false;
}

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "board");
  const started = performance.now();
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  const dateKey = requestedDate === "all" ? null : requestedDate || todayDateKey();
  const includeUndated = defaultIncludeUndatedForDate(dateKey, requestedDate, url);
  const [state, timingInsights, operations] = await Promise.all([
    loadBoardState({ dateKey, includeUndated }),
    getDispatchTimingInsights(1000),
    loadDispatchOperationalSettings().catch(() => null),
  ]);
  const allOrders = [...state.unscheduled, ...state.routes.flatMap((route) => route.orders)];
  const routeByOrderId = new Map(
    state.routes.flatMap((route) => route.orders.map((order) => [order.id, route] as const)),
  );
  const timingHints = Object.fromEntries(
    allOrders.map((order) => [
      order.id,
      getTimingMatchForOrder(order, timingInsights, routeByOrderId.get(order.id)?.driver || ""),
    ]),
  ) as Record<string, DispatchTimingMatch | null>;
  return data({
    ...state,
    mapsConfig: getMapsConfigStatus(),
    timingInsights: {
      sampleCount: timingInsights.sampleCount,
      latestSampleAt: timingInsights.latestSampleAt,
      globalAverage: timingInsights.globalAverage,
    },
    timingHints,
    operations: {
      refreshSeconds: operations?.mapRefreshSeconds || 30,
    },
    dateKey,
    includeUndated,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: any) {
  if (actionResult?.skipBoardRevalidate) return false;
  return defaultShouldRevalidate;
}

export async function action({ request }: { request: Request }) {
  await requireDispatchUser(request, "board");
  await requireDispatchEditor(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const orderId = String(form.get("orderId") || "").trim();

  if (intent === "create-order") {
    const customer = String(form.get("customer") || "").trim();
    const address = String(form.get("address") || "").trim();
    const city = String(form.get("city") || "").trim();
    const material = String(form.get("material") || "").trim();
    const quantity = String(form.get("quantity") || "").trim();
    const unit = String(form.get("unit") || "").trim();
    const lineItems = parseDispatchLineItemsText(String(form.get("lineItemsText") || ""), {
      material,
      quantity,
      unit,
    });

    if (!customer || !address || !city || !material || !quantity || !unit) {
      return data({ ok: false, message: "Customer, address, city, material, quantity, and unit are required." }, { status: 400 });
    }

    const createdOrder = await createDispatchOrder({
      orderNumber: String(form.get("orderNumber") || ""),
      customer,
      contact: String(form.get("contact") || ""),
      address,
      city,
      material,
      quantity,
      unit,
      lineItems,
      requestedWindow: String(form.get("requestedWindow") || ""),
      timePreference: String(form.get("timePreference") || "Anytime"),
      notes: String(form.get("notes") || ""),
    });
    return data({ ok: true, message: `Created order ${createdOrder.orderNumber}.`, createdOrder });
  }

  if (intent === "create-route") {
    const code = String(form.get("code") || "").trim();
    if (!code) return data({ ok: false, message: "Route code is required." }, { status: 400 });

    const createdRoute = await createDispatchRoute({
      code,
      truck: String(form.get("truck") || ""),
      driver: String(form.get("driver") || ""),
      helper: String(form.get("helper") || ""),
      shift: String(form.get("shift") || ""),
      region: String(form.get("region") || ""),
      color: String(form.get("color") || "#38bdf8"),
    });
    return data({ ok: true, message: `Created route ${createdRoute.code}.`, createdRoute });
  }

  if (intent === "calculate-distances") {
    const dateValue = String(form.get("date") || "");
    try {
      const result = await calculateBoardDistances({
        dateKey: dateValue === "all" ? null : dateValue || todayDateKey(),
        includeUndated: String(form.get("includeUndated") || "0") === "1",
        mode: String(form.get("mode") || "missing") === "all" ? "all" : "missing",
        limit: Number(form.get("limit") || 40),
      });
      return data({ ok: true, message: result.message, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Distance calculation failed.";
      return data({
        ok: false,
        message,
        result: {
          ok: false,
          checked: 0,
          updated: 0,
          skipped: 0,
          message,
          details: [message],
        },
      });
    }
  }

  if (!orderId) {
    return data({ ok: false, message: "Missing order." }, { status: 400 });
  }

  if (intent === "assign") {
    const routeId = String(form.get("routeId") || "").trim();
    if (!routeId) return data({ ok: false, message: "Missing route." }, { status: 400 });
    const splitCount = Number(String(form.get("splitCount") || "0"));
    const capacityOverridePassword = String(form.get("capacityOverridePassword") || "");
    const verifiedQuantity = String(form.get("verifiedQuantity") || "");
    const groupShopifyAddOns = String(form.get("groupShopifyAddOns") || "1") !== "0";
    try {
      const assignment = await assignOrder(
        orderId,
        routeId,
        splitCount,
        capacityOverridePassword,
        verifiedQuantity,
        groupShopifyAddOns,
      );
      return data({
        ok: true,
        message: assignment.message,
        updatedOrder: assignment.updatedOrder,
        createdOrders: assignment.createdOrders,
        createdCount: assignment.createdCount,
        skipBoardRevalidate: assignment.createdCount <= 1,
      });
    } catch (error) {
      return data(
        {
          ok: false,
          message: error instanceof Error ? error.message : "Unable to assign order.",
          skipBoardRevalidate: false,
        },
        { status: 400 },
      );
    }
  }

  if (intent === "unassign") {
    const updatedOrder = await unassignOrder(orderId);
    return data({ ok: true, message: "Moved back to queue.", updatedOrder, skipBoardRevalidate: true });
  }

  if (intent === "move-up" || intent === "move-down") {
    const reorderResult = await reorderStop(orderId, intent === "move-up" ? "up" : "down");
    return data({
      ok: true,
      message: "Route sequence updated.",
      updatedOrder: reorderResult.moved,
      reorderResult,
      skipBoardRevalidate: true,
    });
  }

  return data({ ok: false, message: "Unknown action." }, { status: 400 });
}

function orderNumber(order: DispatchOrder) {
  return order.orderNumber ? `#${order.orderNumber}` : order.id;
}

function parsedChecklist(order: DispatchOrder) {
  try {
    return JSON.parse(order.checklistJson || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function shopifyGroupId(order: DispatchOrder) {
  const checklist = parsedChecklist(order);
  return String(checklist.shopifyOrderId || checklist.shopifyOrderName || "").trim();
}

function shopifySku(order: DispatchOrder) {
  const checklist = parsedChecklist(order);
  return String(checklist.sku || checklist.productSourceSku || "").trim();
}

function isShopifyAddOnSku(order: DispatchOrder) {
  return /^(500|700)(?:\D|$)/i.test(shopifySku(order));
}

function baseOrderNumber(order: DispatchOrder) {
  return String(order.orderNumber || "").trim().replace(/[a-z]$/i, "");
}

function orderSearchText(order: DispatchOrder) {
  return [
    order.id,
    order.orderNumber,
    order.customer,
    order.contact,
    order.address,
    order.city,
    order.loadLabel,
    order.material,
    order.quantity,
    order.unit,
    order.requestedWindow,
    order.timePreference,
    order.proofNotes,
    order.status,
    order.deliveryStatus,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function checklistValue(order: DispatchOrder, key: string) {
  try {
    const parsed = JSON.parse(order.checklistJson || "{}");
    return typeof parsed?.[key] === "string" ? parsed[key] : "";
  } catch {
    return "";
  }
}

function checklistObject(order: DispatchOrder, key: string) {
  try {
    const parsed = JSON.parse(order.checklistJson || "{}");
    const value = parsed?.[key];
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stopStatusLabel(order: DispatchOrder) {
  if (order.deliveryStatus !== "en_route") return "Dispatched";
  const loadedQuantity = checklistValue(order, "loadedQuantity");
  return loadedQuantity
    ? `Loaded ${loadedQuantity} ${order.unit} + Enroute`
    : "Loaded + Enroute";
}

function compactDate(value: string) {
  return value || "No date";
}

function compactDeliveredTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function compactRouteTime(value?: Date | string | null) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function routeDeliveryWindows(route: { orders: DispatchOrder[]; deliveredOrders?: DispatchOrder[] }) {
  const windows: Record<string, string> = {};
  const seen = new Set<string>();
  const stops = [...(route.deliveredOrders || []), ...route.orders]
    .filter((order) => {
      if (seen.has(order.id)) return false;
      seen.add(order.id);
      return true;
    })
    .sort((left, right) => {
      const leftSequence = Number(left.stopSequence || 0) || 9999;
      const rightSequence = Number(right.stopSequence || 0) || 9999;
      if (leftSequence !== rightSequence) return leftSequence - rightSequence;
      return orderNumber(left).localeCompare(orderNumber(right), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

  let anchorTime: Date | null = null;
  let elapsedFromAnchor = 0;

  for (const order of stops) {
    const roundTripMinutes = Math.max(0, Math.round(Number(order.travelMinutes || 0)));
    const oneWayMinutes = Math.max(0, Math.round(roundTripMinutes / 2));
    const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt) : null;
    const departedAt = order.departedAt ? new Date(order.departedAt) : null;
    const hasDeliveredAt = deliveredAt && !Number.isNaN(deliveredAt.getTime());
    const hasDepartedAt = departedAt && !Number.isNaN(departedAt.getTime());

    if ((order.status === "delivered" || order.deliveryStatus === "delivered") && hasDeliveredAt) {
      anchorTime = deliveredAt;
      elapsedFromAnchor = oneWayMinutes;
      windows[order.id] = `Delivered ${compactRouteTime(deliveredAt)}`;
      continue;
    }

    if (hasDepartedAt) {
      anchorTime = departedAt;
      elapsedFromAnchor = 0;
    }

    if (!anchorTime) continue;

    const arrivalStart = addMinutes(anchorTime, elapsedFromAnchor + oneWayMinutes);
    const arrivalEnd = addMinutes(arrivalStart, 120);
    windows[order.id] = `${compactRouteTime(arrivalStart)} - ${compactRouteTime(arrivalEnd)}`;
    elapsedFromAnchor += roundTripMinutes;
  }

  return windows;
}

function travelLabel(order: DispatchOrder) {
  const minutes = Number(order.travelMinutes || 0);
  const miles = Number(order.travelMiles || 0);
  if (!minutes && !miles) return "No route time";
  const time = minutes ? `${minutes} min RT` : "Time missing";
  const distance = miles ? `${miles} mi` : "Miles missing";
  return `${time} · ${distance}`;
}

function timingHintLabel(order: DispatchOrder, hint?: DispatchTimingMatch | null) {
  if (!hint?.correctionFactor) {
    const routeTiming = checklistObject(order, "routeTiming");
    if (routeTiming?.mode === "learned") {
      return `Learned: ${routeTiming.source || "history"} · ${routeTiming.samples || 0} samples`;
    }
    if (routeTiming?.mode === "google") return "Google only";
    return "Not recalculated";
  }
  return `Learned: ${hint.source} · ${hint.samples} sample${hint.samples === 1 ? "" : "s"} · ${hint.correctionFactor.toFixed(2)}x`;
}

function hasTimingHint(order: DispatchOrder, hint?: DispatchTimingMatch | null) {
  if (hint?.correctionFactor) return true;
  return Boolean(checklistObject(order, "routeTiming"));
}

function routeTimingCalculatedAt(order: DispatchOrder) {
  const routeTiming = checklistObject(order, "routeTiming");
  return typeof routeTiming?.calculatedAt === "string" ? routeTiming.calculatedAt : "";
}

function isTimingStale(order: DispatchOrder, latestSampleAt?: string | null) {
  const calculatedAt = routeTimingCalculatedAt(order);
  if (!calculatedAt || !latestSampleAt) return false;
  const calculatedTime = new Date(calculatedAt).getTime();
  const latestSampleTime = new Date(latestSampleAt).getTime();
  return Number.isFinite(calculatedTime) && Number.isFinite(latestSampleTime) && calculatedTime < latestSampleTime;
}

function formatMinutes(minutes: number) {
  if (!minutes) return "0 min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function numericValue(value?: string | number | null) {
  const direct = Number(value || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function orderQuantity(order: DispatchOrder) {
  const unitLabel = capacityUnit(order.unit);
  if (unitLabel && order.lineItems.length > 1) {
    const lineItemTotal = order.lineItems
      .filter((item) => capacityUnit(item.unit) === unitLabel)
      .reduce((total, item) => total + numericValue(item.quantity), 0);
    if (lineItemTotal > 0) return lineItemTotal;
  }
  return numericValue(order.quantity);
}

function capacityUnit(unit: string) {
  if (/tons?/i.test(unit)) return "tons";
  if (/yards?/i.test(unit)) return "yards";
  return "";
}

function routeTruckCapacity(route: DispatchBoardState["routes"][number] | undefined, unit: string) {
  const unitLabel = capacityUnit(unit);
  if (!unitLabel) return 0;
  const fleetCapacity = unitLabel === "tons" ? route?.truckTonCapacity : route?.truckYardCapacity;
  if (fleetCapacity && fleetCapacity > 0) return fleetCapacity;

  const truckLabel = route?.truck || "";
  const unitRegex = unitLabel === "tons"
    ? /(\d+(?:\.\d+)?)\s*(?:ton|tons)\b/i
    : /(\d+(?:\.\d+)?)\s*(?:yard|yards|yd|yds)\b/i;
  const explicit = truckLabel.match(unitRegex)?.[1];
  if (explicit) return Number(explicit);
  return unitLabel === "tons" ? 22 : 30;
}

function formatSplitQuantity(value: number) {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function resequenceLocalOrders(orders: DispatchOrder[]) {
  return orders.map((order, index) => ({ ...order, stopSequence: index + 1 }));
}

export default function Board() {
  const loaderData = useLoaderData<typeof loader>() as DispatchBoardState & {
    mapsConfig: { configured: boolean; shopAddress: string };
    timingInsights: {
      sampleCount: number;
      latestSampleAt: string | null;
      globalAverage: {
        averageCorrectionFactor: number | null;
        averageActualRoundTripMinutes: number | null;
      } | null;
    };
    dateKey: string | null;
    includeUndated: boolean;
    operations: {
      refreshSeconds: number;
    };
    loadedAt: string;
    loadMs: number;
  };
  const actionData = useActionData<typeof action>() as any;
  const distanceResult = actionData?.result as DistanceCalculationResult | undefined;
  const fetcher = useFetcher<typeof action>();
  const fetcherData = fetcher.data as {
    result?: DistanceCalculationResult;
    message?: string;
    ok?: boolean;
    updatedOrder?: DispatchOrder;
    reorderResult?: {
      routeId: string;
      routeOrders: DispatchOrder[];
    };
  } | undefined;
  const fetcherDistanceResult = fetcherData?.result;
  const visibleDistanceResult = distanceResult || fetcherDistanceResult;
  const revalidator = useRevalidator();
  useDispatchVersionRevalidator(revalidator, { intervalMs: 6000 });
  const [boardState, setBoardState] = useState<DispatchBoardState>(() => ({
    orders: loaderData.orders,
    routes: loaderData.routes,
    unscheduled: loaderData.unscheduled,
  }));
  const [search, setSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState("");
  const [queueSort, setQueueSort] = useState("date");
  const [draggedOrderId, setDraggedOrderId] = useState("");
  const [selectedDetailOrderId, setSelectedDetailOrderId] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const normalizedQueueFilter = queueFilter.trim().toLowerCase();
  const isRefreshing = revalidator.state !== "idle";
  const isMutating = fetcher.state !== "idle";
  const previousDateKey = shiftDateKey(loaderData.dateKey, -1);
  const nextDateKey = shiftDateKey(loaderData.dateKey, 1);
  const previousDateHref = boardDateHref(
    previousDateKey,
    includeUndatedForTargetDate(previousDateKey, loaderData.includeUndated),
  );
  const todayHref = boardDateHref(todayDateKey(), loaderData.includeUndated);
  const nextDateHref = boardDateHref(
    nextDateKey,
    includeUndatedForTargetDate(nextDateKey, loaderData.includeUndated),
  );
  const allActiveHref = boardDateHref(null, loaderData.includeUndated);

  useEffect(() => {
    setBoardState({
      orders: loaderData.orders,
      routes: loaderData.routes,
      unscheduled: loaderData.unscheduled,
    });
  }, [loaderData.loadedAt, loaderData.orders, loaderData.routes, loaderData.unscheduled]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcherData?.ok === false) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcherData?.ok, revalidator]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && fetcher.state === "idle") {
        revalidator.revalidate();
      }
    }, Math.max(15, Number(loaderData.operations?.refreshSeconds || 30)) * 1000);
    return () => window.clearInterval(interval);
  }, [fetcher.state, loaderData.operations?.refreshSeconds, revalidator]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcherDistanceResult?.updated) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcherDistanceResult?.updated, revalidator]);

  useEffect(() => {
    if (fetcher.state !== "idle" || fetcherData?.ok !== true || !fetcherData?.updatedOrder) return;
    if (fetcherData.reorderResult?.routeId) {
      setBoardState((current) => ({
        ...current,
        routes: current.routes.map((route) =>
          route.id === fetcherData.reorderResult?.routeId
            ? { ...route, orders: fetcherData.reorderResult.routeOrders }
            : route,
        ),
      }));
    }
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [fetcher.state, fetcherData?.ok, fetcherData?.updatedOrder, fetcherData?.reorderResult, revalidator]);

  const unscheduled = useMemo(() => {
    const filtered = boardState.unscheduled.filter((order) => {
      const searchText = orderSearchText(order);
      return (
        (!normalizedSearch || searchText.includes(normalizedSearch)) &&
        (!normalizedQueueFilter || searchText.includes(normalizedQueueFilter))
      );
    });

    return [...filtered].sort((a, b) => {
      if (queueSort === "material") {
        return (
          a.material.localeCompare(b.material) ||
          a.city.localeCompare(b.city) ||
          a.customer.localeCompare(b.customer)
        );
      }
      if (queueSort === "city") {
        return (
          a.city.localeCompare(b.city) ||
          a.material.localeCompare(b.material) ||
          a.customer.localeCompare(b.customer)
        );
      }
      if (queueSort === "time") {
        return (
          a.timePreference.localeCompare(b.timePreference) ||
          a.requestedWindow.localeCompare(b.requestedWindow) ||
          a.customer.localeCompare(b.customer)
        );
      }
      if (queueSort === "quantity") {
        return (
          Number.parseFloat(b.quantity || "0") - Number.parseFloat(a.quantity || "0") ||
          a.material.localeCompare(b.material)
        );
      }
      if (queueSort === "rt") {
        const aMinutes = Number(a.travelMinutes || 0);
        const bMinutes = Number(b.travelMinutes || 0);
        if (!aMinutes && bMinutes) return 1;
        if (aMinutes && !bMinutes) return -1;
        return (
          aMinutes - bMinutes ||
          a.requestedWindow.localeCompare(b.requestedWindow) ||
          a.customer.localeCompare(b.customer)
        );
      }
      return (
        a.requestedWindow.localeCompare(b.requestedWindow) ||
        a.timePreference.localeCompare(b.timePreference) ||
        a.customer.localeCompare(b.customer)
      );
    });
  }, [boardState.unscheduled, normalizedSearch, normalizedQueueFilter, queueSort]);

  const routes = useMemo(
    () =>
      boardState.routes
        .map((route) => ({
          ...route,
          orders: normalizedSearch
            ? route.orders.filter((order) => orderSearchText(order).includes(normalizedSearch))
            : route.orders,
        }))
        .sort(
          (a, b) =>
            b.orders.length - a.orders.length ||
            a.code.localeCompare(b.code, undefined, { numeric: true }),
        ),
    [boardState.routes, normalizedSearch],
  );

  const routeTotalMinutes = useMemo(
    () =>
      Object.fromEntries(
        boardState.routes.map((route) => [
          route.id,
          route.orders.reduce((total, order) => total + Number(order.travelMinutes || 0), 0),
        ]),
      ) as Record<string, number>,
    [boardState.routes],
  );
  const routeDeliveryWindowLabels = useMemo(
    () =>
      Object.fromEntries(
        boardState.routes.map((route) => [route.id, routeDeliveryWindows(route)]),
      ) as Record<string, Record<string, string>>,
    [boardState.routes],
  );
  const boardTotals = useMemo(() => {
    const assignedOrders = boardState.routes.flatMap((route) => route.orders);
    const assignedTravelMinutes = assignedOrders.reduce(
      (total, order) => total + Number(order.travelMinutes || 0),
      0,
    );
    const missingTravelCount = [...boardState.unscheduled, ...assignedOrders].filter(
      (order) => !Number(order.travelMinutes || 0) || !Number(order.travelMiles || 0),
    ).length;

    return {
      unscheduled: boardState.unscheduled.length,
      assigned: assignedOrders.length,
      routes: boardState.routes.length,
      assignedTravelMinutes,
      missingTravelCount,
    };
  }, [boardState.routes, boardState.unscheduled]);
  const selectedDetail = useMemo(() => {
    for (const route of boardState.routes) {
      const order = route.orders.find((entry) => entry.id === selectedDetailOrderId);
      if (order) return { order, route };
    }
    const order = boardState.unscheduled.find((entry) => entry.id === selectedDetailOrderId);
    return order ? { order, route: null } : null;
  }, [boardState.routes, boardState.unscheduled, selectedDetailOrderId]);

  function submitMutation(payload: Record<string, string>) {
    if (
      (payload.intent !== "assign" || Number(payload.splitCount || 0) <= 1) &&
      !payload.capacityOverridePassword
    ) {
      applyOptimisticMutation(payload);
    }
    fetcher.submit(payload, { method: "post" });
  }

  function getAssignmentCapacityPayload(order: DispatchOrder, routeId: string) {
    const route = boardState.routes.find((entry) => entry.id === routeId);
    const unitLabel = capacityUnit(order.unit);
    if (!unitLabel) return {};

    if (!route?.truck?.trim()) {
      window.alert("Assign a truck number to this route before adding ton or yard loads.");
      return null;
    }

    const quantity = orderQuantity(order);
    const capacity = routeTruckCapacity(route, order.unit);
    if (!quantity || !capacity || quantity <= capacity) return {};

    const minimumSplits = Math.ceil(quantity / capacity);
    const shouldSplit = window.confirm(
      `${orderNumber(order)} is ${formatSplitQuantity(quantity)} ${unitLabel}, which is over ${route.truck}'s ${formatSplitQuantity(
        capacity,
      )} ${unitLabel} limit.\n\nPress OK to split the order into multiple tickets.\nPress Cancel for a manager override for this one delivery.`,
    );

    if (!shouldSplit) {
      const password = window.prompt("Manager override password for this one delivery:");
      if (password === null) return null;
      if (!password.trim()) {
        window.alert("Manager override password is required.");
        return null;
      }
      return { capacityOverridePassword: password };
    }

    const answer = window.prompt(
      `How many tickets should I split ${orderNumber(order)} into?`,
      String(minimumSplits),
    );

    if (answer === null) return null;
    const splitCount = Math.floor(Number(answer));
    if (!Number.isFinite(splitCount) || splitCount < minimumSplits) {
      window.alert(`Use at least ${minimumSplits} split tickets so each load fits the truck.`);
      return null;
    }

    return { splitCount: String(splitCount) };
  }

  function getQueueQuantityVerificationPayload(order: DispatchOrder) {
    const expectedQuantity = orderQuantity(order);
    if (!expectedQuantity) {
      window.alert("This order is missing a quantity, so it cannot be assigned yet.");
      return null;
    }

    const answer = window.prompt(
      `PLEASE CHECK SHOPIFY FOR ANY CHANGES!!\n\nEnter the order quantity to move ${orderNumber(order)} to a route:`,
      "",
    );

    if (answer === null) return null;
    const typedQuantity = numericValue(answer);
    if (!typedQuantity || Math.abs(typedQuantity - expectedQuantity) > 0.0001) {
      window.alert("Quantity verification failed. Please check Shopify, then enter the correct order quantity.");
      return null;
    }

    return { verifiedQuantity: formatSplitQuantity(typedQuantity) };
  }

  function submitAssignment(order: DispatchOrder, routeId: string) {
    const isQueueOrder = boardState.unscheduled.some((entry) => entry.id === order.id);
    const verificationPayload = isQueueOrder ? getQueueQuantityVerificationPayload(order) : {};
    if (verificationPayload === null) return;
    const capacityPayload = getAssignmentCapacityPayload(order, routeId);
    if (capacityPayload === null) return;
    const groupId = shopifyGroupId(order);
    const orderBase = baseOrderNumber(order);
    const addOnSiblings = groupId
      ? [...boardState.unscheduled, ...boardState.routes.flatMap((route) => route.orders)]
        .filter((entry) =>
          entry.id !== order.id &&
          shopifyGroupId(entry) === groupId &&
          baseOrderNumber(entry) === orderBase &&
          isShopifyAddOnSku(entry),
        )
      : [];
    const groupShopifyAddOns = addOnSiblings.length
      ? window.confirm(
        `This Shopify order has add-on item${addOnSiblings.length === 1 ? "" : "s"} that can ride with this stop:\n\n${
          addOnSiblings.map((entry) => `${orderNumber(entry)} · ${entry.loadLabel || `${entry.quantity} ${entry.unit} ${entry.material}`}`).join("\n")
        }\n\nPress OK to assign them with this stop.\nPress Cancel to assign only ${orderNumber(order)}.`,
      )
      : true;
    submitMutation({
      intent: "assign",
      orderId: order.id,
      routeId,
      groupShopifyAddOns: groupShopifyAddOns ? "1" : "0",
      ...verificationPayload,
      ...capacityPayload,
    });
  }

  function applyOptimisticMutation(payload: Record<string, string>) {
    if (payload.intent === "assign" && payload.orderId && payload.routeId) {
      setBoardState((current) => {
        const sourceOrder =
          current.unscheduled.find((order) => order.id === payload.orderId) ||
          current.routes.flatMap((route) => route.orders).find((order) => order.id === payload.orderId);
        if (!sourceOrder) return current;

        const nextRoutes = current.routes.map((route) => ({
          ...route,
          orders: route.orders.filter((order) => order.id !== payload.orderId),
        }));
        const targetRouteIndex = nextRoutes.findIndex((route) => route.id === payload.routeId);
        if (targetRouteIndex < 0) return current;

        const assignedOrder = {
          ...sourceOrder,
          assignedRouteId: payload.routeId,
          status: "scheduled" as const,
          deliveryStatus: "not_started" as const,
          stopSequence: nextRoutes[targetRouteIndex].orders.length + 1,
        };
        nextRoutes[targetRouteIndex] = {
          ...nextRoutes[targetRouteIndex],
          orders: resequenceLocalOrders([...nextRoutes[targetRouteIndex].orders, assignedOrder]),
        };

        return {
          ...current,
          orders: current.orders.map((order) => (order.id === payload.orderId ? assignedOrder : order)),
          routes: nextRoutes.map((route) => ({ ...route, orders: resequenceLocalOrders(route.orders) })),
          unscheduled: current.unscheduled.filter((order) => order.id !== payload.orderId),
        };
      });
      return;
    }

    if (payload.intent === "unassign" && payload.orderId) {
      setBoardState((current) => {
        const sourceOrder = current.routes
          .flatMap((route) => route.orders)
          .find((order) => order.id === payload.orderId);
        if (!sourceOrder) return current;

        const unassignedOrder = {
          ...sourceOrder,
          assignedRouteId: null,
          stopSequence: null,
          status: "new" as const,
          deliveryStatus: "not_started" as const,
          eta: null,
        };

        return {
          ...current,
          orders: current.orders.map((order) => (order.id === payload.orderId ? unassignedOrder : order)),
          routes: current.routes.map((route) => ({
            ...route,
            orders: resequenceLocalOrders(route.orders.filter((order) => order.id !== payload.orderId)),
          })),
          unscheduled: [unassignedOrder, ...current.unscheduled.filter((order) => order.id !== payload.orderId)],
        };
      });
      return;
    }

    if ((payload.intent === "move-up" || payload.intent === "move-down") && payload.orderId) {
      setBoardState((current) => ({
        ...current,
        routes: current.routes.map((route) => {
          const index = route.orders.findIndex((order) => order.id === payload.orderId);
          if (index < 0) return route;
          const nextIndex = payload.intent === "move-up" ? index - 1 : index + 1;
          if (nextIndex < 0 || nextIndex >= route.orders.length) return route;

          const reordered = [...route.orders];
          const [moved] = reordered.splice(index, 1);
          reordered.splice(nextIndex, 0, moved);
          return { ...route, orders: resequenceLocalOrders(reordered) };
        }),
      }));
    }
  }

  function startDrag(orderId: string, event: DragEvent<HTMLElement>) {
    setDraggedOrderId(orderId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", orderId);
  }

  function dropOnRoute(routeId: string, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const orderId = event.dataTransfer.getData("text/plain") || draggedOrderId;
    if (!orderId) return;
    const order =
      boardState.unscheduled.find((entry) => entry.id === orderId) ||
      boardState.routes.flatMap((route) => route.orders).find((entry) => entry.id === orderId);
    if (!order) return;
    submitAssignment(order, routeId);
    setDraggedOrderId("");
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Green Hills Dispatch</p>
          <h1>Dispatch v2 Sandbox</h1>
          <p className="muted">
            Planning {loaderData.dateKey || "all active days"}
            {loaderData.includeUndated && loaderData.dateKey ? " plus undated orders" : ""}.
          </p>
        </div>
        <div className="topbarActions">
          <PermissionNav />
          <div className="statusBox">
            <strong>{loaderData.loadMs}ms</strong>
            <span>{isRefreshing ? "refreshing" : "server load"}</span>
            <small>{new Date(loaderData.loadedAt).toLocaleTimeString()}</small>
          </div>
        </div>
      </header>

      {(actionData?.message || fetcher.data?.message || isMutating) ? (
        <div className={(actionData?.ok ?? fetcher.data?.ok) === false ? "notice error" : "notice"}>
          {isMutating ? "Saving dispatch change..." : actionData?.message || fetcher.data?.message}
        </div>
      ) : null}

      <section className="toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search order, customer, address, material, date..."
        />
        <Form method="get" className="dayFilter">
          <label>
            Dispatch date
            <input name="date" type="date" defaultValue={loaderData.dateKey || todayDateKey()} />
          </label>
          <label className="checkLabel">
            <input
              name="includeUndated"
              type="checkbox"
              value="1"
              defaultChecked={loaderData.includeUndated}
            />
            Include undated
          </label>
          <input type="hidden" name="includeUndated" value="0" />
          <button type="submit" disabled={isRefreshing}>
            {isRefreshing ? "Loading..." : "Open Day"}
          </button>
        </Form>
        <Link className="toolbarLink" to="?date=all">
          All active
        </Link>
      </section>

      <section className="dateJumpBar">
        <Link to={previousDateHref}>Previous day</Link>
        <Link to={todayHref}>Today</Link>
        <Link to={nextDateHref}>Next day</Link>
        <Link to={allActiveHref}>All active</Link>
        <span>
          Current view: <strong>{loaderData.dateKey || "All active days"}</strong>
          {loaderData.includeUndated && loaderData.dateKey ? " + undated" : ""}
        </span>
      </section>

      <section className="boardStats">
        <article className="panel statTile compactStat">
          <span>Unscheduled</span>
          <strong>{boardTotals.unscheduled}</strong>
        </article>
        <article className="panel statTile compactStat">
          <span>Assigned Stops</span>
          <strong>{boardTotals.assigned}</strong>
        </article>
        <article className="panel statTile compactStat">
          <span>Active Routes</span>
          <strong>{boardTotals.routes}</strong>
        </article>
        <article className="panel statTile compactStat">
          <span>Route Time</span>
          <strong>{formatMinutes(boardTotals.assignedTravelMinutes)}</strong>
        </article>
        <article className="panel statTile compactStat">
          <span>Missing Times</span>
          <strong>{boardTotals.missingTravelCount}</strong>
        </article>
      </section>

      <section className="distanceBar">
        <div>
          <p className="eyebrow">Maps</p>
          <p className="muted">
            Shop origin: {loaderData.mapsConfig.shopAddress}
            {!loaderData.mapsConfig.configured ? " · Add GOOGLE_MAPS_API_KEY to enable calculations." : ""}
          </p>
          <p className="muted">
            Learned timing: {loaderData.timingInsights.sampleCount} delivered samples
            {loaderData.timingInsights.globalAverage?.averageCorrectionFactor
              ? ` · avg ${loaderData.timingInsights.globalAverage.averageCorrectionFactor}x Google`
              : ""}
          </p>
        </div>
        <div className="distanceActionGroup">
          <fetcher.Form method="post" className="distanceActions">
            <input type="hidden" name="intent" value="calculate-distances" />
            <input type="hidden" name="date" value={loaderData.dateKey || "all"} />
            <input type="hidden" name="includeUndated" value={loaderData.includeUndated ? "1" : "0"} />
            <input type="hidden" name="mode" value="missing" />
            <input type="hidden" name="limit" value="40" />
            <button type="submit" disabled={!loaderData.mapsConfig.configured || isMutating}>
              Current View Missing
            </button>
          </fetcher.Form>
          <fetcher.Form method="post" className="distanceActions">
            <input type="hidden" name="intent" value="calculate-distances" />
            <input type="hidden" name="date" value={loaderData.dateKey || "all"} />
            <input type="hidden" name="includeUndated" value={loaderData.includeUndated ? "1" : "0"} />
            <input type="hidden" name="mode" value="all" />
            <input type="hidden" name="limit" value="20" />
            <button type="submit" disabled={!loaderData.mapsConfig.configured || isMutating}>
              Refresh Current Times
            </button>
          </fetcher.Form>
          <fetcher.Form method="post" className="distanceActions">
            <input type="hidden" name="intent" value="calculate-distances" />
            <input type="hidden" name="date" value="all" />
            <input type="hidden" name="includeUndated" value="1" />
            <input type="hidden" name="mode" value="missing" />
            <input type="hidden" name="limit" value="80" />
            <button type="submit" disabled={!loaderData.mapsConfig.configured || isMutating}>
              All Active Missing
            </button>
          </fetcher.Form>
        </div>
      </section>

      {visibleDistanceResult ? (
        <section className={visibleDistanceResult.ok ? "panel distanceResults" : "panel distanceResults errorPanel"}>
          <strong>{visibleDistanceResult.message}</strong>
          <p>
            Checked {visibleDistanceResult.checked}, updated {visibleDistanceResult.updated}, skipped{" "}
            {visibleDistanceResult.skipped}.
          </p>
          {visibleDistanceResult.details.slice(0, 12).map((detail) => <p key={detail}>{detail}</p>)}
        </section>
      ) : null}

      <section className="layout">
        <aside className="panel queuePanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>Unscheduled</h2>
            </div>
            <span className="count">{unscheduled.length}</span>
          </div>
          <div className="queueTools">
            <input
              value={queueFilter}
              onChange={(event) => setQueueFilter(event.currentTarget.value)}
              placeholder="Filter queue only..."
            />
            <select value={queueSort} onChange={(event) => setQueueSort(event.currentTarget.value)}>
              <option value="date">Sort by date</option>
              <option value="time">Sort by time preference</option>
              <option value="material">Sort by material</option>
              <option value="city">Sort by city</option>
              <option value="quantity">Sort by quantity</option>
              <option value="rt">Sort by RT time</option>
            </select>
          </div>

          <div className="orderList">
            {unscheduled.map((order) => (
              <article
                key={order.id}
                className="orderCard"
                draggable
                onDragStart={(event) => startDrag(order.id, event)}
              >
                <strong>{order.customer || "No customer"}</strong>
                <span>{order.address}, {order.city}</span>
                <small>
                  {orderNumber(order)} · {order.quantity} {order.unit}
                </small>
                <small className="materialLine" title={order.loadLabel || order.material}>
                  {order.loadLabel || order.material}
                </small>
                <small>{compactDate(order.requestedWindow)} · {order.timePreference}</small>
                <small className={order.travelMinutes ? "travelChip" : "travelChip missing"}>
                  {travelLabel(order)}
                </small>
                <small className={hasTimingHint(order, loaderData.timingHints[order.id]) ? "timingChip" : "timingChip missing"}>
                  {timingHintLabel(order, loaderData.timingHints[order.id])}
                </small>
                {isTimingStale(order, loaderData.timingInsights.latestSampleAt) ? (
                  <small className="timingChip stale">Timing changed since calculated</small>
                ) : null}
                <div className="assignRow">
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const routeId = event.currentTarget.value;
                      if (routeId) submitAssignment(order, routeId);
                      event.currentTarget.value = "";
                    }}
                  >
                    <option value="">Assign to route...</option>
                    {boardState.routes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.code} · {route.truck}
                      </option>
                    ))}
                  </select>
                </div>
              </article>
            ))}
            {!unscheduled.length ? <div className="empty">No unscheduled orders.</div> : null}
          </div>
        </aside>

        <section className="routesGrid">
          {routes.map((route) => (
            <article
              key={route.id}
              className="panel routePanel"
              style={{ "--route-color": route.color } as CSSProperties}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropOnRoute(route.id, event)}
            >
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Route</p>
                  <h2>{route.code}</h2>
                  <p className="muted">
                    {route.truck || "No truck"} · {route.driver || "No driver"} · {route.shift || "No shift"}
                  </p>
                  <p className="muted">
                    Route time: {routeTotalMinutes[route.id] ? `${formatMinutes(routeTotalMinutes[route.id])} RT` : "not calculated"}
                  </p>
                </div>
                <span className="count">{route.orders.length}</span>
              </div>

              {route.deliveredOrders.length ? (
                <div className="deliveredRouteStrip" aria-label={`Delivered stops for ${route.code}`}>
                  {route.deliveredOrders.slice(0, 8).map((order) => (
                    <span key={order.id} title={`${orderNumber(order)} delivered at ${compactDeliveredTime(order.deliveredAt)}`}>
                      <strong>{orderNumber(order)}</strong>
                      <em>{compactDeliveredTime(order.deliveredAt)}</em>
                    </span>
                  ))}
                  {route.deliveredOrders.length > 8 ? (
                    <small>+{route.deliveredOrders.length - 8}</small>
                  ) : null}
                </div>
              ) : null}

              <div className="routeStops">
                {route.orders.map((order, index) => (
                  <article key={order.id} className="stopRow">
                    <div className="stopNumber">{index + 1}</div>
                    <div className="stopBody">
                      <strong>{orderNumber(order)} · {order.customer}</strong>
                      <span>{order.address}, {order.city}</span>
                      <small>
                        {order.quantity} {order.unit}
                      </small>
                      <small className="materialLine" title={order.loadLabel || order.material}>
                        {order.loadLabel || order.material}
                      </small>
                      <div className="stopMetaChips">
                        <small className="timePreferenceChip">
                          Time: {order.timePreference || "Anytime"}
                        </small>
                        <small className="stopStatusLine">
                          <span className={order.deliveryStatus === "en_route" ? "miniStatus enroute" : "miniStatus"}>
                            {stopStatusLabel(order)}
                          </span>
                        </small>
                        {order.eta ? <small className="miniStatus">ETA {order.eta}</small> : null}
                        <small className={routeDeliveryWindowLabels[route.id]?.[order.id] ? "deliveryWindowChip" : "deliveryWindowChip missing"}>
                          {routeDeliveryWindowLabels[route.id]?.[order.id]
                            ? `Window: ${routeDeliveryWindowLabels[route.id][order.id]}`
                            : "Window starts after first Enroute"}
                        </small>
                        <small className={order.travelMinutes ? "travelChip" : "travelChip missing"}>
                          {travelLabel(order)}
                        </small>
                        <small className={hasTimingHint(order, loaderData.timingHints[order.id]) ? "timingChip" : "timingChip missing"}>
                          {timingHintLabel(order, loaderData.timingHints[order.id])}
                        </small>
                        {isTimingStale(order, loaderData.timingInsights.latestSampleAt) ? (
                          <small className="timingChip stale">Timing changed since calculated</small>
                        ) : null}
                      </div>
                    </div>
                    <div className="stopActions">
                      <button
                        type="button"
                        onClick={() => setSelectedDetailOrderId(order.id)}
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        onClick={() => submitMutation({ intent: "move-up", orderId: order.id })}
                        disabled={index === 0 || isMutating}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => submitMutation({ intent: "move-down", orderId: order.id })}
                        disabled={index === route.orders.length - 1 || isMutating}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => submitMutation({ intent: "unassign", orderId: order.id })}
                        disabled={isMutating}
                      >
                        Unassign
                      </button>
                    </div>
                  </article>
                ))}
                {!route.orders.length ? (
                  <div className="empty">Drop orders here or assign from the queue.</div>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      </section>

      <section className="creationGrid compactCreation">
        <Form method="post" className="panel createCard">
          <input type="hidden" name="intent" value="create-route" />
          <div className="panelHeader">
            <div>
              <p className="eyebrow">New Route</p>
              <h2>Create route</h2>
            </div>
          </div>
          <div className="createFields routeCreateFields">
            <label>
              Code
              <input name="code" placeholder="R-310" required />
            </label>
            <label>
              Truck
              <input name="truck" placeholder="310" />
            </label>
            <label>
              Driver
              <input name="driver" placeholder="Driver name" />
            </label>
            <label>
              Shift
              <input name="shift" placeholder="6:00a - 2:30p" />
            </label>
            <label>
              Region
              <input name="region" placeholder="North / Germantown" />
            </label>
            <label>
              Color
              <input name="color" type="color" defaultValue="#38bdf8" />
            </label>
          </div>
          <button className="primaryButton" type="submit">Add Route</button>
        </Form>

        <Form method="post" className="panel createCard">
          <input type="hidden" name="intent" value="create-order" />
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Manual Intake</p>
              <h2>Create order</h2>
            </div>
          </div>
          <div className="createFields orderCreateFields">
            <label>
              Order number
              <input name="orderNumber" placeholder="Optional" />
            </label>
            <label>
              Customer
              <input name="customer" placeholder="Customer name" required />
            </label>
            <label>
              Contact
              <input name="contact" placeholder="Phone or email" />
            </label>
            <label>
              Address
              <input name="address" placeholder="Street address" required />
            </label>
            <label>
              City
              <input name="city" placeholder="City, ST ZIP" required />
            </label>
            <label>
              Requested
              <input name="requestedWindow" type="date" defaultValue={loaderData.dateKey || ""} />
            </label>
            <label>
              Material
              <input name="material" placeholder="Material" required />
            </label>
            <label>
              Quantity
              <input name="quantity" inputMode="decimal" placeholder="10" required />
            </label>
            <label>
              Unit
              <select name="unit" defaultValue="Yard" required>
                <option>Yard</option>
                <option>Ton</option>
                <option>Bag</option>
                <option>Gallon</option>
                <option>Unit</option>
              </select>
            </label>
            <label className="wideField">
              Multiple items on this stop
              <textarea
                name="lineItemsText"
                rows={3}
                placeholder={"4 Bag Grass Seed\n2 Bag Fertilizer"}
              />
              <small className="muted">Optional. One item per line, all routed as one stop.</small>
            </label>
            <label>
              Time
              <select name="timePreference" defaultValue="Anytime">
                <option>Anytime</option>
                <option>Morning</option>
                <option>Afternoon</option>
                <option>Evening</option>
              </select>
            </label>
            <label className="wideField">
              Notes
              <textarea name="notes" placeholder="Order notes, delivery instructions, or Shopify-style order note" rows={3} />
            </label>
          </div>
          <button className="successButton" type="submit">Add Order</button>
        </Form>
      </section>

      {selectedDetail ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onClick={() => setSelectedDetailOrderId("")}
        >
          <section
            className="panel orderDetailsModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Order Details</p>
                <h2 id="order-details-title">
                  {orderNumber(selectedDetail.order)} · {selectedDetail.order.customer || "No customer"}
                </h2>
                <p className="muted">
                  {selectedDetail.route
                    ? `${selectedDetail.route.code} · ${selectedDetail.route.truck || "No truck"} · Stop ${
                        selectedDetail.order.stopSequence || "-"
                      }`
                    : "Unscheduled"}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedDetailOrderId("")}>
                Close
              </button>
            </div>

            <div className="orderDetailsGrid">
              <div>
                <span>Customer</span>
                <strong>{selectedDetail.order.customer || "No customer"}</strong>
              </div>
              <div>
                <span>Phone / Email</span>
                <strong>{selectedDetail.order.contact || "Not entered"}</strong>
              </div>
              <div className="wideField">
                <span>Address</span>
                <strong>{selectedDetail.order.address || "No address"}</strong>
                <small>{selectedDetail.order.city || "No city"}</small>
              </div>
              <div>
                <span>Load</span>
                <strong>{selectedDetail.order.loadLabel || selectedDetail.order.material || "No material"}</strong>
              </div>
              <div>
                <span>Quantity</span>
                <strong>
                  {selectedDetail.order.quantity || "0"} {selectedDetail.order.unit || "Unit"}
                </strong>
              </div>
              <div>
                <span>Requested</span>
                <strong>{compactDate(selectedDetail.order.requestedWindow)}</strong>
              </div>
              <div>
                <span>Time Preference</span>
                <strong>{selectedDetail.order.timePreference || "Anytime"}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>
                  {selectedDetail.order.status} · {stopStatusLabel(selectedDetail.order)}
                </strong>
              </div>
              <div>
                <span>ETA</span>
                <strong>{selectedDetail.order.eta || "Not set"}</strong>
              </div>
              <div>
                <span>Delivery Window</span>
                <strong>
                  {selectedDetail.route
                    ? routeDeliveryWindowLabels[selectedDetail.route.id]?.[selectedDetail.order.id] ||
                      "Starts after first Enroute"
                    : "Not assigned"}
                </strong>
              </div>
              <div>
                <span>Round Trip</span>
                <strong>{travelLabel(selectedDetail.order)}</strong>
              </div>
              <div>
                <span>Delivered</span>
                <strong>
                  {selectedDetail.order.deliveredAt
                    ? new Date(selectedDetail.order.deliveredAt).toLocaleString()
                    : "Not delivered"}
                </strong>
              </div>
              <div className="wideField">
                <span>Notes</span>
                <strong>{selectedDetail.order.proofNotes || "No notes"}</strong>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
