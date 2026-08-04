import { data } from "react-router";
import { requireDispatchUser } from "../lib/auth.server";
import { supabaseAdmin } from "../lib/supabase.server";

async function latestUpdatedAt(table: string) {
  const { data: row, error } = await supabaseAdmin
    .from(table)
    .select("updated_at")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return row?.updated_at || "";
}

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request);

  const [latestOrderUpdatedAt, latestRouteUpdatedAt] = await Promise.all([
    latestUpdatedAt("dispatch_orders"),
    latestUpdatedAt("dispatch_routes"),
  ]);

  const latestUpdatedAtValue =
    latestOrderUpdatedAt && latestRouteUpdatedAt
      ? latestOrderUpdatedAt > latestRouteUpdatedAt
        ? latestOrderUpdatedAt
        : latestRouteUpdatedAt
      : latestOrderUpdatedAt || latestRouteUpdatedAt || "";

  return data(
    {
      ok: true,
      version: latestUpdatedAtValue,
      latestOrderUpdatedAt,
      latestRouteUpdatedAt,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
