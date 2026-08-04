import { getProductUnitLabelsByHandlesAndSkus } from "../lib/product-unit-labels.server";

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
  const skus = url.searchParams.getAll("sku").map((value) => value.trim()).filter(Boolean);

  if ((!shop || !handles.length) && !skus.length) {
    return jsonResponse({ labelsByHandle: {}, labelsBySku: {} }, 400);
  }

  try {
    const result = await getProductUnitLabelsByHandlesAndSkus(shop, handles, skus);
    return jsonResponse(result);
  } catch (error: any) {
    console.error("[UNIT LABELS API ERROR]", error);
    return jsonResponse(
      {
        labelsByHandle: {},
        labelsBySku: {},
        color: "#d1d5db",
        message: error?.message || "Failed to load unit labels.",
      },
      500,
    );
  }
}

export async function action() {
  return jsonResponse({ ok: true });
}
