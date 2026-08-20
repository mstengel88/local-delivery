import { timingSafeEqual } from "node:crypto";
import { data } from "react-router";
import { createDispatchGhosLink } from "../lib/auth.server";

const GHOS_INTEGRATION_SECRET = process.env.GHOS_INTEGRATION_SECRET || "";

function hasValidIntegrationSecret(request: Request) {
  const supplied = request.headers.get("x-ghos-integration-secret") || "";
  if (!GHOS_INTEGRATION_SECRET || supplied.length !== GHOS_INTEGRATION_SECRET.length) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(supplied, "utf8"),
    Buffer.from(GHOS_INTEGRATION_SECRET, "utf8"),
  );
}

export async function action({ request }: { request: Request }) {
  if (request.method.toUpperCase() !== "POST") {
    return data({ ok: false, message: "Method not allowed." }, { status: 405 });
  }
  if (!hasValidIntegrationSecret(request)) {
    return data({ ok: false, message: "Unauthorized GHOS integration request." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const tokenHash = await createDispatchGhosLink({
      email: typeof body?.email === "string" ? body.email : "",
      displayName: typeof body?.displayName === "string" ? body.displayName : "",
      ghosUserId: typeof body?.ghosUserId === "string" ? body.ghosUserId : "",
      role: typeof body?.role === "string" ? body.role : "viewer",
      permissions: Array.isArray(body?.permissions)
        ? body.permissions.filter((value: unknown): value is string => typeof value === "string")
        : [],
    });
    return data(
      { ok: true, tokenHash },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return data(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Dispatch V2 SSO failed.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
