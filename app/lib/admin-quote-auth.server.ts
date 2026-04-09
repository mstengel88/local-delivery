import { createCookie } from "react-router";

const cookieSecret = process.env.QUOTE_ACCESS_COOKIE_SECRET || "dev-secret-change-me";

export const adminQuoteCookie = createCookie("admin_quote_access", {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: true,
  secrets: [cookieSecret],
  maxAge: 60 * 60 * 12,
});

export async function hasAdminQuoteAccess(request: Request) {
  const cookieHeader = request.headers.get("Cookie");
  const cookieValue = await adminQuoteCookie.parse(cookieHeader);
  return cookieValue === "ok";
}

export async function requireAdminQuoteAccess(request: Request) {
  const ok = await hasAdminQuoteAccess(request);
  if (!ok) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

export function getAdminQuotePassword() {
  return process.env.ADMIN_QUOTE_PASSWORD || "";
}