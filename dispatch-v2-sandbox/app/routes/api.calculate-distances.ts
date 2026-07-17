import { data } from "react-router";
import { calculateBoardDistances, getMapsConfigStatus } from "../lib/dispatch.server";

const DISTANCE_CALC_SECRET = process.env.DISTANCE_CALC_SECRET || process.env.DISPATCH_IMPORT_SECRET || "";

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

function getOptions(request: Request) {
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  return {
    dateKey: requestedDate === "all" ? null : requestedDate || todayDateKey(),
    includeUndated: url.searchParams.get("includeUndated") !== "0",
    mode: url.searchParams.get("mode") === "all" ? "all" as const : "missing" as const,
    limit: Number(url.searchParams.get("limit") || 40),
  };
}

function assertAuthorized(request: Request) {
  if (!DISTANCE_CALC_SECRET) return "DISTANCE_CALC_SECRET or DISPATCH_IMPORT_SECRET is not configured.";
  const url = new URL(request.url);
  const providedSecret =
    request.headers.get("x-dispatch-secret") ||
    request.headers.get("x-distance-secret") ||
    url.searchParams.get("secret") ||
    "";
  return providedSecret === DISTANCE_CALC_SECRET ? "" : "Unauthorized distance calculation request.";
}

async function runCalculation(request: Request) {
  const authorizationError = assertAuthorized(request);
  if (authorizationError) {
    return data({ ok: false, message: authorizationError }, { status: authorizationError.startsWith("Unauthorized") ? 401 : 500 });
  }

  const mapsConfig = getMapsConfigStatus();
  if (!mapsConfig.configured) {
    return data({ ok: false, message: "GOOGLE_MAPS_API_KEY is not configured." }, { status: 500 });
  }

  try {
    const result = await calculateBoardDistances(getOptions(request));
    return data({ ...result, ranAt: new Date().toISOString() });
  } catch (error) {
    return data(
      {
        ok: false,
        checked: 0,
        updated: 0,
        skipped: 0,
        message: error instanceof Error ? error.message : "Distance calculation failed.",
        details: [],
        ranAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export function loader({ request }: { request: Request }) {
  return runCalculation(request);
}

export function action({ request }: { request: Request }) {
  return runCalculation(request);
}
