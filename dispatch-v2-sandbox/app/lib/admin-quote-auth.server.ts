import { createCookie } from "react-router";
import { getCurrentDispatchUser, type DispatchPermission } from "./auth.server";

export const adminQuoteCookie = createCookie("dispatch_v2_quote_legacy", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
});

const QUOTE_PERMISSION_MAP: Record<string, DispatchPermission> = {
  quoteTool: "board",
  reviewQuotes: "orders",
  sendToShopify: "orders",
};

export async function hasAdminQuotePermissionAccess(request: Request, permission = "quoteTool") {
  const user = await getCurrentDispatchUser(request);
  if (!user) return false;
  if (user.role.role === "admin") return true;

  const dispatchPermission = QUOTE_PERMISSION_MAP[permission] || "board";
  return user.role.permissions.includes(dispatchPermission);
}

export async function hasAdminQuoteAccess(request: Request) {
  return hasAdminQuotePermissionAccess(request, "quoteTool");
}
