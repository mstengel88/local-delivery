import { getProductUnitLabelsByHandles } from "../lib/product-unit-labels.server";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}

export async function loader({ request }: any) {
  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") || "").trim();
  const handles = url.searchParams.getAll("handle").map((value) => value.trim()).filter(Boolean);

  if (!shop || !handles.length) {
    return jsonResponse({ labels: {} }, 400);
  }

  try {
    const labels = await getProductUnitLabelsByHandles(shop, handles);
    return jsonResponse({ labels });
  } catch (error: any) {
    console.error("[UNIT LABELS API ERROR]", error);
    return jsonResponse(
      { labels: {}, message: error?.message || "Failed to load unit labels." },
      500,
    );
  }
}

export async function action() {
  return jsonResponse({ ok: true });
}
