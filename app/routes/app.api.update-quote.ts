import { data } from "react-router";
import {
  getCustomQuoteById,
  updateCustomQuote,
} from "../lib/custom-quotes.server";
import { hasAdminQuoteAccess } from "../lib/admin-quote-auth.server";
import { authenticate } from "../shopify.server";
import { getQuote } from "../lib/quote-engine.server";

function normalizeQuantity(value: FormDataEntryValue | null) {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function buildSourceBreakdown(
  lineItems: Array<{
    title: string;
    sku: string;
    vendor?: string;
    quantity: number;
  }>,
) {
  const grouped = new Map<
    string,
    { vendor: string; quantity: number; items: string[] }
  >();

  for (const line of lineItems) {
    const vendor = line.vendor || "Unknown";
    const existing = grouped.get(vendor) || {
      vendor,
      quantity: 0,
      items: [],
    };

    existing.quantity += line.quantity;
    existing.items.push(`${line.title} (${line.sku})`);
    grouped.set(vendor, existing);
  }

  return Array.from(grouped.values());
}

export async function action({ request }: { request: Request }) {
  const url = new URL(request.url);
  const isEmbeddedRequest = url.pathname.startsWith("/app/");

  if (isEmbeddedRequest) {
    await authenticate.admin(request);
  } else {
    const allowed = await hasAdminQuoteAccess(request);
    if (!allowed) {
      return data({ ok: false, message: "Please log in." }, { status: 401 });
    }
  }

  const form = await request.formData();
  const quoteId = String(form.get("quoteId") || "").trim();

  if (!quoteId) {
    return data({ ok: false, message: "Missing quote id." }, { status: 400 });
  }

  const existing = await getCustomQuoteById(quoteId);
  if (!existing) {
    return data({ ok: false, message: "Quote not found." }, { status: 404 });
  }

  const oldLineItems = existing.line_items || [];
  const lineItems = oldLineItems
    .map((line, index) => ({
      ...line,
      quantity: normalizeQuantity(form.get(`lineQuantity::${index}`)),
    }))
    .filter((line) => line.quantity > 0);

  if (lineItems.length === 0) {
    return data(
      { ok: false, message: "At least one line item must have quantity greater than 0." },
      { status: 400 },
    );
  }

  const customerName = String(form.get("customerName") || "").trim();
  const customerEmail = String(form.get("customerEmail") || "").trim();
  const customerPhone = String(form.get("customerPhone") || "").trim();
  const address1 = String(form.get("address1") || "").trim();
  const address2 = String(form.get("address2") || "").trim();
  const city = String(form.get("city") || "").trim();
  const province = String(form.get("province") || "").trim();
  const postalCode = String(form.get("postalCode") || "").trim();
  const country = String(form.get("country") || "US").trim() || "US";

  if (!address1 || !city || !province || !postalCode) {
    return data(
      { ok: false, message: "Address 1, city, state, and ZIP are required to regenerate." },
      { status: 400 },
    );
  }

  const productsSubtotal = lineItems.reduce(
    (sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 0),
    0,
  );
  const deliveryQuote = await getQuote({
    shop: existing.shop || process.env.SHOPIFY_STORE_DOMAIN || "darfaz-2e.myshopify.com",
    postalCode,
    country,
    province,
    city,
    address1,
    address2,
    items: lineItems.map((line) => ({
      sku: line.sku,
      quantity: Number(line.quantity || 0),
      requiresShipping: true,
      pickupVendor: line.vendor,
      price: Number(line.price || 0),
    })),
  });

  const deliveryAmount = Number(deliveryQuote.cents || 0) / 100;
  const taxRate = Number(process.env.QUOTE_TAX_RATE || "0");
  const taxAmount = (productsSubtotal + deliveryAmount) * taxRate;
  const totalAmount = productsSubtotal + deliveryAmount + taxAmount;

  const updatedQuote = await updateCustomQuote(quoteId, {
    customerName,
    customerEmail,
    customerPhone,
    address1,
    address2,
    city,
    province,
    postalCode,
    country,
    quoteTotalCents: Math.round(totalAmount * 100),
    serviceName: deliveryQuote.serviceName,
    shippingDetails: `Delivery Fee: $${deliveryAmount.toFixed(2)}`,
    description: deliveryQuote.description,
    eta: deliveryQuote.eta,
    summary: deliveryQuote.summary,
    sourceBreakdown: buildSourceBreakdown(lineItems),
    lineItems,
  });

  return data({
    ok: true,
    message: "Quote regenerated.",
    quote: updatedQuote,
  });
}
