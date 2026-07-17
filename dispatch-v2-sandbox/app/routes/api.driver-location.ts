import { data } from "react-router";
import { requireDispatchUser } from "../lib/auth.server";
import { upsertDriverLocation } from "../lib/dispatch.server";

function numberFrom(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return data({ ok: false, message: "Method not allowed." }, { status: 405 });
  }

  try {
    await requireDispatchUser(request, "driver");
  } catch (error) {
    if (error instanceof Response) {
      return data(
        { ok: false, message: "Driver tracking is not authenticated. Log in again on the driver device." },
        { status: error.status >= 300 && error.status < 400 ? 401 : error.status },
      );
    }
    return data(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Driver tracking authentication failed.",
      },
      { status: 503 },
    );
  }

  const contentType = request.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await request.json()
    : Object.fromEntries(await request.formData());

  const routeId = String(body.routeId || "").trim();
  const latitude = numberFrom(body.latitude);
  const longitude = numberFrom(body.longitude);

  if (!routeId || latitude === null || longitude === null) {
    return data({ ok: false, message: "Route, latitude, and longitude are required." }, { status: 400 });
  }

  let location;
  try {
    location = await upsertDriverLocation({
      routeId,
      latitude,
      longitude,
      accuracy: numberFrom(body.accuracy),
      heading: numberFrom(body.heading),
      speed: numberFrom(body.speed),
      capturedAt: typeof body.capturedAt === "string" ? body.capturedAt : null,
    });
  } catch (error) {
    return data(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to save driver GPS location.",
      },
      { status: 500 },
    );
  }

  return data({ ok: true, location });
}

export async function loader() {
  return data({ ok: false, message: "Driver tracking expects POST requests." }, { status: 405 });
}
