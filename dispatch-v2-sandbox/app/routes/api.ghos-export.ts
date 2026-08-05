import { timingSafeEqual } from "node:crypto";
import { data } from "react-router";
import {
  loadOrdersForMaintenance,
  loadRoutesForMaintenance,
} from "../lib/dispatch.server";
import { loadOpenDispatchOrderIds } from "../lib/ghos-export.server";

const GHOS_INTEGRATION_SECRET =
  process.env.GHOS_INTEGRATION_SECRET ||
  process.env.DISPATCH_IMPORT_SECRET ||
  "";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

function secretsMatch(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

function authorize(request: Request) {
  if (!GHOS_INTEGRATION_SECRET) {
    return {
      status: 503,
      message: "GHOS_INTEGRATION_SECRET is not configured.",
    };
  }

  const provided = request.headers.get("x-ghos-secret") || "";
  if (!provided || !secretsMatch(provided, GHOS_INTEGRATION_SECRET)) {
    return {
      status: 401,
      message: "Unauthorized GHOS integration request.",
    };
  }

  return null;
}

function parseLimit(url: URL) {
  const value = Number(url.searchParams.get("limit") || DEFAULT_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(value), MAX_LIMIT));
}

function parseUpdatedAfter(url: URL) {
  const value = url.searchParams.get("updatedAfter");
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isUpdatedAfter(value: string, threshold: Date | null) {
  if (!threshold) return true;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp > threshold;
}

export async function loader({ request }: { request: Request }) {
  const authorizationError = authorize(request);
  if (authorizationError) {
    return data(
      { ok: false, message: authorizationError.message },
      {
        status: authorizationError.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const url = new URL(request.url);
  const limit = parseLimit(url);
  const updatedAfter = parseUpdatedAfter(url);

  try {
    const [loadedOrders, routes, openOrderIds] = await Promise.all([
      loadOrdersForMaintenance(limit),
      loadRoutesForMaintenance(250),
      loadOpenDispatchOrderIds(),
    ]);

    const orders = loadedOrders.filter((order) =>
      isUpdatedAfter(order.updatedAt, updatedAfter),
    );
    const generatedAt = new Date().toISOString();
    const latestUpdatedAt = orders.reduce(
      (latest, order) =>
        order.updatedAt && order.updatedAt > latest ? order.updatedAt : latest,
      updatedAfter?.toISOString() || "",
    );

    return data(
      {
        ok: true,
        version: "1",
        generatedAt,
        cursor: latestUpdatedAt || generatedAt,
        count: orders.length,
        hasMore: loadedOrders.length === limit,
        openOrderIds,
        orders: orders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          customer: order.customer,
          contact: order.contact,
          address: order.address,
          city: order.city,
          material: order.material,
          quantity: order.quantity,
          unit: order.unit,
          requestedWindow: order.requestedWindow,
          timePreference: order.timePreference,
          status: order.status,
          assignedRouteId: order.assignedRouteId,
          stopSequence: order.stopSequence,
          deliveryStatus: order.deliveryStatus,
          eta: order.eta,
          travelMinutes: order.travelMinutes,
          travelMiles: order.travelMiles,
          departedAt: order.departedAt,
          deliveredAt: order.deliveredAt,
          proofName: order.proofName,
          proofNotes: order.proofNotes,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        })),
        routes: routes.map((route) => ({
          id: route.id,
          code: route.code,
          truck: route.truck,
          driver: route.driver,
          helper: route.helper,
          shift: route.shift,
          region: route.region,
          isActive: route.isActive,
          updatedAt: route.updatedAt,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return data(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "GHOS export could not be generated.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
