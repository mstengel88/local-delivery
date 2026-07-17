import { createCookie } from "react-router";
import {
  getCurrentDispatchUser,
  type DispatchPermission,
  type DispatchUserSession,
} from "./auth.server";
import { writeAuditLog } from "./dispatch.server";

export const userAuthCookie = createCookie("dispatch_v2_quote_user_legacy", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
});

export type QuoteUser = {
  id: string;
  email: string;
  name: string;
  permissions: string[];
};

function toQuoteUser(session: DispatchUserSession | null): QuoteUser | null {
  if (!session) return null;
  const legacyPermissions =
    session.role.role === "admin"
      ? ["admin", "quoteTool", "reviewQuotes", "sendToShopify", "dispatch", "manageUsers"]
      : [
          ...(session.role.permissions.includes("board") ? ["quoteTool", "dispatch"] : []),
          ...(session.role.permissions.includes("orders") ? ["reviewQuotes", "sendToShopify"] : []),
          ...(session.role.permissions.includes("settings") ? ["manageUsers"] : []),
        ];

  return {
    id: session.id,
    email: session.email,
    name: session.role.displayName || session.email,
    permissions: Array.from(new Set([...session.role.permissions, ...legacyPermissions])),
  };
}

const PERMISSION_MAP: Record<string, DispatchPermission> = {
  quoteTool: "board",
  reviewQuotes: "orders",
  sendToShopify: "orders",
  manageQuotes: "orders",
};

export async function getCurrentUser(request: Request) {
  return toQuoteUser(await getCurrentDispatchUser(request));
}

export async function hasUserPermission(request: Request, permission: string) {
  const session = await getCurrentDispatchUser(request);
  if (!session) return false;
  if (session.role.role === "admin") return true;
  const dispatchPermission = PERMISSION_MAP[permission] || "board";
  return session.role.permissions.includes(dispatchPermission);
}

export async function logAuditEvent(input: {
  actor?: QuoteUser | null;
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  details?: unknown;
}) {
  await writeAuditLog({
    action: input.action,
    actor: input.actor?.name || input.actor?.email || "quote-tool",
    message: [input.targetType, input.targetLabel || input.targetId].filter(Boolean).join(": ") || input.action,
    orderId: input.targetType === "quote" ? input.targetId : undefined,
    after: input.details,
  }).catch((error) => {
    console.warn("[QUOTE AUDIT WARNING]", error);
  });
}
