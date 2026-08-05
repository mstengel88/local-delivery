import { supabaseAdmin } from "./supabase.server";

const PAGE_SIZE = 1000;

export async function loadOpenDispatchOrderIds() {
  const ids: string[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("dispatch_orders")
      .select("id")
      .or("status.is.null,and(status.neq.delivered,status.neq.cancelled)")
      .or(
        "delivery_status.is.null,and(delivery_status.neq.delivered,delivery_status.neq.cancelled)",
      )
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(
        `Unable to build the authoritative Dispatch open-order snapshot: ${error.message}`,
      );
    }

    const page = (data || [])
      .map((row) => String(row.id || "").trim())
      .filter(Boolean);
    ids.push(...page);

    if (page.length < PAGE_SIZE) {
      return ids;
    }
  }
}
