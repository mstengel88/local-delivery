import { createClient } from "@supabase/supabase-js";
import type { RealtimeClientOptions } from "@supabase/realtime-js";
import { data, redirect } from "react-router";
import WebSocket from "ws";
import { writeAuditLog } from "./dispatch.server";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DISPATCH_ADMIN_EMAILS = (process.env.DISPATCH_ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const SESSION_COOKIE = "dispatch_v2_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 14;
const AUTH_REQUEST_TIMEOUT_MS = 7000;
const AUTH_SESSION_CACHE_MS = 60_000;
const DISPATCH_ROLE_CACHE_MS = 60_000;
const DISPATCH_VIEW_ROLE = "dispatch_view";
const DISPATCH_VIEW_PERMISSIONS = new Set<string>([
  "board",
] as const);

const supabaseRealtimeTransport = WebSocket as unknown as NonNullable<
  RealtimeClientOptions["transport"]
>;

let cachedAdminClient: ReturnType<typeof createClient> | null = null;

const authSessionCache = new Map<
  string,
  {
    expiresAt: number;
    user: { id: string; email?: string | null };
  }
>();

const dispatchRoleCache = new Map<
  string,
  {
    expiresAt: number;
    role: DispatchUserRole;
  }
>();

function getAdminClient() {
  if (cachedAdminClient) return cachedAdminClient;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for dispatch roles.");
  }

  cachedAdminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    realtime: { transport: supabaseRealtimeTransport },
  });
  return cachedAdminClient;
}

function createAuthClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY for dispatch login.");
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    realtime: { transport: supabaseRealtimeTransport },
  });
}

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown login error");
  if (message.includes("dispatch_user_roles") || message.includes("schema cache")) {
    return "Dispatch role storage is not ready. Run the updated sql/phase3_reliability.sql in Supabase SQL Editor, then try logging in again.";
  }
  if (message.includes("SUPABASE_ANON_KEY")) {
    return "Missing SUPABASE_ANON_KEY in the dispatch v2 .env file. Add the anon/public key from Supabase Project Settings > API, then restart the container.";
  }
  if (message.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    return "Missing SUPABASE_SERVICE_ROLE_KEY in the dispatch v2 .env file. Add the service role key from Supabase Project Settings > API, then restart the container.";
  }
  if (message.includes("Invalid API key") || message.includes("Invalid JWT")) {
    return "Supabase rejected one of the API keys. Check SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in the dispatch v2 .env file.";
  }
  return message;
}

async function withAuthTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out. Check Supabase connectivity from the dispatch container.`));
        }, AUTH_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const DISPATCH_PERMISSIONS = [
  { key: "board", label: "Board" },
  { key: "calendar", label: "Calendar" },
  { key: "allotment", label: "Allotment" },
  { key: "driver", label: "Driver" },
  { key: "loader", label: "Loader" },
  { key: "monitor", label: "Monitor" },
  { key: "map", label: "Map" },
  { key: "orders", label: "Orders" },
  { key: "routes", label: "Routes" },
  { key: "imports", label: "Imports" },
  { key: "updates", label: "Updates" },
  { key: "timing", label: "Timing" },
  { key: "audit", label: "Audit" },
  { key: "settings", label: "Settings" },
] as const;

export type DispatchPermission = (typeof DISPATCH_PERMISSIONS)[number]["key"];

export type DispatchUserRole = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  permissions: DispatchPermission[];
  isActive: boolean;
};

export type DispatchUserSession = {
  id: string;
  email: string;
  role: DispatchUserRole;
};

type StoredSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
};

function encodeSession(session: StoredSession) {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

function decodeSession(value: string): StoredSession | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (parsed?.accessToken && parsed?.refreshToken) return parsed;
  } catch {
    // Bad cookies should behave like no login.
  }
  return null;
}

function pruneExpiringCache<T>(cache: Map<string, { expiresAt: number } & T>) {
  const now = Date.now();
  for (const [key, value] of cache) {
    if (value.expiresAt <= now) cache.delete(key);
  }
}

function cacheExpiresAt(maxAgeMs: number, tokenExpiresAt?: number | null) {
  const ttlExpiresAt = Date.now() + maxAgeMs;
  if (!tokenExpiresAt) return ttlExpiresAt;
  // Keep a small safety window so we do not reuse an auth result after the JWT expires.
  return Math.min(ttlExpiresAt, tokenExpiresAt * 1000 - 5_000);
}

function sessionCacheKey(accessToken: string) {
  return accessToken;
}

function getCachedSessionUser(stored: StoredSession) {
  pruneExpiringCache(authSessionCache);
  const cached = authSessionCache.get(sessionCacheKey(stored.accessToken));
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.user;
}

function setCachedSessionUser(stored: StoredSession, user: { id: string; email?: string | null }) {
  pruneExpiringCache(authSessionCache);
  authSessionCache.set(sessionCacheKey(stored.accessToken), {
    expiresAt: cacheExpiresAt(AUTH_SESSION_CACHE_MS, stored.expiresAt),
    user,
  });
  if (authSessionCache.size > 1000) authSessionCache.clear();
}

function getCachedDispatchRole(userId: string) {
  pruneExpiringCache(dispatchRoleCache);
  const cached = dispatchRoleCache.get(userId);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.role;
}

function setCachedDispatchRole(role: DispatchUserRole) {
  pruneExpiringCache(dispatchRoleCache);
  dispatchRoleCache.set(role.userId, {
    expiresAt: Date.now() + DISPATCH_ROLE_CACHE_MS,
    role,
  });
  if (dispatchRoleCache.size > 1000) dispatchRoleCache.clear();
}

function parseCookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index < 0) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function cookieHeader(value: string, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearDispatchSessionCookie() {
  return cookieHeader("", 0);
}

function sessionFromAuth(session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
}): StoredSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at || null,
  };
}

async function roleCount() {
  const supabaseAdmin = getAdminClient();
  const { count, error } = await supabaseAdmin
    .from("dispatch_user_roles")
    .select("user_id", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

function normalizePermissions(value: unknown): DispatchPermission[] {
  const allowed = new Set(DISPATCH_PERMISSIONS.map((permission) => permission.key));
  if (!Array.isArray(value)) return [];
  return value
    .map((permission) => String(permission))
    .filter((permission): permission is DispatchPermission => allowed.has(permission as DispatchPermission));
}

function normalizeRole(row: any): DispatchUserRole {
  return {
    userId: String(row.user_id || ""),
    email: String(row.email || "").toLowerCase(),
    displayName: String(row.display_name || row.email || ""),
    role: String(row.role || "viewer"),
    permissions: normalizePermissions(row.permissions),
    isActive: row.is_active !== false,
  };
}

function adminPermissions(): DispatchPermission[] {
  return DISPATCH_PERMISSIONS.map((permission) => permission.key);
}

export function canReadDispatchPermission(role: DispatchUserRole | null | undefined, permission?: DispatchPermission) {
  if (!role) return false;
  if (!permission) return true;
  if (role.role === "admin") return true;
  if (role.role === DISPATCH_VIEW_ROLE && DISPATCH_VIEW_PERMISSIONS.has(permission)) return true;
  return role.permissions.includes(permission);
}

export function canEditDispatch(role: DispatchUserRole | null | undefined) {
  return role?.role === "admin" || role?.role === "dispatcher";
}

async function ensureRoleForUser(user: { id: string; email?: string | null }) {
  const supabaseAdmin = getAdminClient();
  const email = String(user.email || "").toLowerCase();
  if (!email) throw new Error("Supabase user is missing an email address.");

  const cachedRole = getCachedDispatchRole(user.id);
  if (cachedRole) return cachedRole;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("dispatch_user_roles")
    .select("user_id, email, display_name, role, permissions, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing) {
    const role = normalizeRole(existing);
    setCachedDispatchRole(role);
    return role;
  }

  const shouldBootstrapAdmin = DISPATCH_ADMIN_EMAILS.includes(email) || (await roleCount()) === 0;
  const role = shouldBootstrapAdmin ? "admin" : "viewer";
  const permissions = shouldBootstrapAdmin ? adminPermissions() : ["driver" as DispatchPermission];

  const { data: created, error: createError } = await supabaseAdmin
    .from("dispatch_user_roles")
    .insert({
      user_id: user.id,
      email,
      display_name: email,
      role,
      permissions,
      is_active: true,
    })
    .select("user_id, email, display_name, role, permissions, is_active")
    .single();

  if (createError) throw new Error(createError.message);
  const createdRole = normalizeRole(created);
  setCachedDispatchRole(createdRole);
  return createdRole;
}

export async function createDispatchLoginSession(input: {
  email: string;
  password: string;
  redirectTo: string;
}) {
  try {
    const authClient = createAuthClient();
    const { data: loginData, error } = await authClient.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error || !loginData.session || !loginData.user) {
      return data({ ok: false, message: error?.message || "Unable to sign in." }, { status: 401 });
    }

    const role = await ensureRoleForUser(loginData.user);
    if (!role.isActive) {
      return data({ ok: false, message: "This dispatch user is disabled." }, { status: 403 });
    }

    return redirect(input.redirectTo || "/", {
      headers: {
        "Set-Cookie": cookieHeader(encodeSession(sessionFromAuth(loginData.session))),
      },
    });
  } catch (error) {
    return data({ ok: false, message: friendlyAuthError(error) }, { status: 500 });
  }
}

export async function getDispatchAuthSetupStatus() {
  const status = {
    ok: false,
    supabaseUrl: Boolean(SUPABASE_URL),
    anonKey: Boolean(SUPABASE_ANON_KEY),
    serviceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    adminEmailsConfigured: DISPATCH_ADMIN_EMAILS.length > 0,
    roleStorage: "unknown" as "ready" | "missing" | "error" | "unknown",
    roleCount: null as number | null,
    message: "",
  };

  if (!status.supabaseUrl || !status.anonKey || !status.serviceRoleKey) {
    status.roleStorage = "missing";
    status.message =
      "Missing one or more required Supabase environment variables. Check SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.";
    return status;
  }

  try {
    status.roleCount = await roleCount();
    status.roleStorage = "ready";
    status.ok = true;
    status.message = "Dispatch auth is configured.";
    return status;
  } catch (error) {
    status.roleStorage = "error";
    status.message = friendlyAuthError(error);
    return status;
  }
}

async function getUserFromStoredSession(request: Request): Promise<{
  user: { id: string; email?: string | null };
  session: StoredSession;
  refreshedSession?: StoredSession;
} | null> {
  const stored = decodeSession(parseCookies(request)[SESSION_COOKIE] || "");
  if (!stored) return null;

  const cachedUser = getCachedSessionUser(stored);
  if (cachedUser) return { user: cachedUser, session: stored };

  const authClient = createAuthClient();
  const { data: userData, error } = await withAuthTimeout(
    authClient.auth.getUser(stored.accessToken),
    "Supabase auth user lookup",
  );
  if (!error && userData.user) {
    setCachedSessionUser(stored, userData.user);
    return { user: userData.user, session: stored };
  }

  const { data: refreshed, error: refreshError } = await withAuthTimeout(
    authClient.auth.refreshSession({
      refresh_token: stored.refreshToken,
    }),
    "Supabase auth refresh",
  );
  if (refreshError || !refreshed.session || !refreshed.user) return null;

  const refreshedSession = sessionFromAuth(refreshed.session);
  setCachedSessionUser(refreshedSession, refreshed.user);

  return {
    user: refreshed.user,
    session: stored,
    refreshedSession,
  };
}

export async function getCurrentDispatchUser(request: Request) {
  const session = await getUserFromStoredSession(request);
  if (!session) return null;
  const role = await ensureRoleForUser(session.user);
  if (!role.isActive) return null;
  return {
    id: session.user.id,
    email: String(session.user.email || role.email),
    role,
    refreshedSession: session.refreshedSession,
  };
}

export async function requireDispatchUser(
  request: Request,
  permission?: DispatchPermission,
): Promise<DispatchUserSession> {
  const current = await getCurrentDispatchUser(request);
  const url = new URL(request.url);
  if (!current) {
    throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  if (current.refreshedSession) {
    throw redirect(url.pathname + url.search, {
      headers: {
        "Set-Cookie": cookieHeader(encodeSession(current.refreshedSession)),
      },
    });
  }

  const canAccess =
    !permission ||
    canReadDispatchPermission(current.role, permission);

  if (!canAccess) {
    throw data(
      { message: `You do not have permission to open ${permission}.` },
      { status: 403 },
    );
  }

  return {
    id: current.id,
    email: current.email,
    role: current.role,
  };
}

export async function requireDispatchEditor(request: Request): Promise<DispatchUserSession> {
  const current = await requireDispatchUser(request);
  if (!canEditDispatch(current.role)) {
    throw data(
      { message: "This dispatch account is view-only. A dispatcher or admin role is required to make changes." },
      { status: 403 },
    );
  }
  return current;
}

export async function listDispatchUsers() {
  const supabaseAdmin = getAdminClient();
  const [{ data: usersData, error: usersError }, { data: rolesData, error: rolesError }] =
    await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
      supabaseAdmin
        .from("dispatch_user_roles")
        .select("user_id, email, display_name, role, permissions, is_active")
        .order("email", { ascending: true }),
    ]);

  if (usersError) throw new Error(usersError.message);
  if (rolesError) throw new Error(rolesError.message);

  const rolesByUserId = new Map((rolesData || []).map((role) => [String(role.user_id), normalizeRole(role)]));
  const rolesByEmail = new Map((rolesData || []).map((role) => [String(role.email).toLowerCase(), normalizeRole(role)]));

  return (usersData.users || []).map((user) => ({
    id: user.id,
    email: String(user.email || "").toLowerCase(),
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at,
    role: rolesByUserId.get(user.id) || rolesByEmail.get(String(user.email || "").toLowerCase()) || null,
  }));
}

export async function saveDispatchUserRole(input: {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
}) {
  const supabaseAdmin = getAdminClient();
  const permissions = normalizePermissions(input.permissions);
  const { data: saved, error } = await supabaseAdmin
    .from("dispatch_user_roles")
    .upsert(
      {
        user_id: input.userId,
        email: input.email.toLowerCase(),
        display_name: input.displayName || input.email,
        role: input.role || "viewer",
        permissions,
        is_active: input.isActive,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("user_id, email, display_name, role, permissions, is_active")
    .single();

  if (error) throw new Error(error.message);
  const role = normalizeRole(saved);
  dispatchRoleCache.delete(role.userId);
  setCachedDispatchRole(role);
  return role;
}

export async function createDispatchUser(input: {
  email: string;
  temporaryPassword: string;
  displayName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
  actorEmail: string;
}) {
  const email = input.email.trim().toLowerCase();
  const temporaryPassword = String(input.temporaryPassword || "");
  if (!email || !email.includes("@")) {
    throw new Error("Enter a valid email address for the new user.");
  }
  if (temporaryPassword.length < 8) {
    throw new Error("Temporary password must be at least 8 characters.");
  }

  const supabaseAdmin = getAdminClient();
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: {
      display_name: input.displayName || email,
      password_reset_required: true,
      created_by: input.actorEmail,
      created_at: new Date().toISOString(),
    },
  });

  if (error) throw new Error(error.message);
  if (!created.user) throw new Error("Supabase did not return the created user.");

  const role = await saveDispatchUserRole({
    userId: created.user.id,
    email,
    displayName: input.displayName || email,
    role: input.role || "viewer",
    permissions: input.permissions,
    isActive: input.isActive,
  });

  await writeAuditLog({
    action: "create_dispatch_user",
    actor: input.actorEmail,
    message: `${input.actorEmail} created dispatch user ${email}.`,
    after: {
      userId: created.user.id,
      email,
      role: role.role,
      permissions: role.permissions,
      isActive: role.isActive,
    },
  });

  return { user: created.user, role };
}

export async function resetDispatchUserPassword(input: {
  userId: string;
  email: string;
  temporaryPassword: string;
  actorEmail: string;
}) {
  const temporaryPassword = String(input.temporaryPassword || "");
  if (temporaryPassword.length < 8) {
    throw new Error("Temporary password must be at least 8 characters.");
  }

  const supabaseAdmin = getAdminClient();
  const { data: updated, error } = await supabaseAdmin.auth.admin.updateUserById(
    input.userId,
    {
      password: temporaryPassword,
      user_metadata: {
        password_reset_by: input.actorEmail,
        password_reset_at: new Date().toISOString(),
      },
    },
  );

  if (error) throw new Error(error.message);
  authSessionCache.clear();

  await writeAuditLog({
    action: "reset_user_password",
    actor: input.actorEmail,
    message: `${input.actorEmail} reset password for ${input.email}.`,
    after: {
      userId: input.userId,
      email: input.email,
      updatedAt: updated.user?.updated_at || new Date().toISOString(),
    },
  });

  return updated.user;
}
