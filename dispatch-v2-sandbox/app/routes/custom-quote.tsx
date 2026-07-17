import { type FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useLocation, useNavigation } from "react-router";
import { data, redirect } from "react-router";
import {
  getRecentCustomQuotes,
  saveCustomQuote,
} from "../lib/custom-quotes.server";
import {
  adminQuoteCookie,
  hasAdminQuotePermissionAccess,
} from "../lib/admin-quote-auth.server";
import { getCurrentUser, logAuditEvent, userAuthCookie } from "../lib/user-auth.server";
import {
  getProductOptionsFromSupabase,
  type QuoteProductOption,
} from "../lib/quote-products.server";
import {
  getPricingLabel,
  getUnitPriceForProduct,
  normalizeContractorTier,
  normalizeQuoteAudience,
  type ContractorTier,
  type QuoteAudience,
} from "../lib/quote-pricing";
import { getConfiguredQuoteTaxRate } from "../lib/quote-tax";
import { attachAddressAutocomplete, loadGooglePlaces } from "../lib/google-places";
import { getQuote } from "../lib/quote-engine.server";
import {
  loadDispatchB2BCompanies,
  type DispatchB2BCompany,
} from "../lib/dispatch.server";

type QuoteLine = {
  sku: string;
  quantity: string;
  search: string;
  customTitle?: string;
  customPrice?: string;
};

type SavedQuoteRecord = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  payment_terms_name?: string | null;
  payment_terms_due_in_days?: number | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  quote_total_cents: number;
  service_name?: string | null;
  shipping_details?: string | null;
  description?: string | null;
  eta?: string | null;
  summary?: string | null;
  created_by_user_id?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  source_breakdown?: Array<{
    vendor: string;
    quantity: number;
    items: string[];
  }> | null;
  line_items?: Array<{
    title: string;
    sku: string;
    quantity: number;
    vendor?: string;
    price?: number;
    variantId?: string | null;
    pricingLabel?: string;
    audience?: string;
    contractorTier?: string | null;
  }> | null;
  created_at: string;
};

function getSourceBreakdown(
  selectedLines: Array<{
    title: string;
    sku: string;
    vendor: string;
    quantity: number;
  }>,
) {
  const grouped = new Map<
    string,
    { vendor: string; quantity: number; items: string[] }
  >();

  for (const line of selectedLines) {
    const existing = grouped.get(line.vendor) || {
      vendor: line.vendor,
      quantity: 0,
      items: [],
    };

    existing.quantity += line.quantity;
    existing.items.push(`${line.title} (${line.sku})`);
    grouped.set(line.vendor, existing);
  }

  return Array.from(grouped.values());
}

function formatQuantityWithUnit(quantity: number, unitLabel?: string | null) {
  const normalizedQuantity = Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toFixed(2).replace(/\.?0+$/, "");
  const baseUnit = String(unitLabel || "")
    .trim()
    .replace(/^per\s+/i, "")
    .trim();
  const normalizedUnit =
    baseUnit && quantity !== 1 && !baseUnit.toLowerCase().endsWith("s")
      ? `${baseUnit}S`
      : baseUnit;

  return normalizedUnit
    ? `${normalizedQuantity} ${normalizedUnit}`
    : `Qty ${normalizedQuantity}`;
}

function escapePrintHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrintMoney(value: unknown) {
  const amount = Number(value || 0);
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

function buildPrintableQuoteHtml(actionData: any, logoUrl: string) {
  const selectedLines = Array.isArray(actionData?.selectedLines)
    ? actionData.selectedLines
    : [];
  const pricing = actionData?.pricing || {};
  const address = actionData?.address || {};
  const deliveryQuote = actionData?.deliveryQuote || {};
  const customerLines = [
    actionData?.companyName,
    actionData?.customerName,
    actionData?.customerEmail,
    actionData?.customerPhone,
  ].filter(Boolean);
  const addressLines = [
    address.address1,
    address.address2,
    [address.city, address.province, address.postalCode].filter(Boolean).join(", "),
    address.country,
  ].filter(Boolean);
  const quoteDate = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
  const companyContactLines = [
    "W185N7487 Narrow Lane",
    "Menomonee Falls, WI 53051",
    "(262) 345-4001",
    "info@greenhillssupply.com",
  ];
  const normalizedEta = String(deliveryQuote.eta || "")
    .trim()
    .replace(/[–—]/g, "-")
    .toLowerCase();
  const etaLine =
    normalizedEta && !/^2\s*-\s*4\s+business\s+days$/.test(normalizedEta)
      ? `<div>${escapePrintHtml(deliveryQuote.eta)}</div>`
      : "";
  const lineRows =
    selectedLines
      .map((line: any) => {
        const quantity = Number(line.quantity || 0);
        const lineTotal = Number(line.price || 0) * quantity;

        return `
          <tr>
            <td>
              <strong>${escapePrintHtml(line.title)}</strong>
              <span>${escapePrintHtml(line.sku || "")}</span>
            </td>
            <td>${escapePrintHtml(formatQuantityWithUnit(quantity, line.unitLabel))}</td>
            <td>${escapePrintHtml(formatPrintMoney(line.price))}</td>
            <td>${escapePrintHtml(formatPrintMoney(lineTotal))}</td>
          </tr>`;
      })
      .join("") ||
    `<tr><td colspan="4" class="empty">No product lines available.</td></tr>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Green Hills Supply Quote</title>
  <style>
    @page { margin: 0.45in; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #172033;
      font-family: Arial, Helvetica, sans-serif;
      background: #ffffff;
    }
    .quote {
      max-width: 850px;
      margin: 0 auto;
      border: 2px solid #111827;
      border-radius: 18px;
      overflow: hidden;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 26px;
      padding: 24px 30px;
      border-bottom: 6px solid #8fd400;
      background: linear-gradient(135deg, #f7fbef 0%, #ffffff 72%);
    }
    .brand { width: 210px; text-align: center; }
    .logo { width: 180px; max-height: 110px; object-fit: contain; }
    .company-contact {
      margin-top: 8px;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.35;
    }
    .title { flex: 1; text-align: right; }
    h1 { margin: 0; font-size: 34px; line-height: 1; letter-spacing: -0.03em; }
    .date { margin-top: 10px; color: #475569; font-size: 14px; font-weight: 700; }
    .section { padding: 24px 30px; border-bottom: 1px solid #d8dee8; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .label {
      color: #0f766e;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .box {
      min-height: 112px;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      padding: 14px 16px;
      line-height: 1.45;
      font-size: 15px;
    }
    .box strong { display: block; font-size: 17px; margin-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #111827;
      color: #ffffff;
      padding: 11px 12px;
      text-align: left;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    td {
      border-bottom: 1px solid #d8dee8;
      padding: 13px 12px;
      vertical-align: top;
      font-size: 14px;
    }
    td span { display: block; color: #64748b; margin-top: 4px; font-size: 12px; }
    th:nth-child(2), th:nth-child(3), th:nth-child(4),
    td:nth-child(2), td:nth-child(3), td:nth-child(4) { text-align: right; white-space: nowrap; }
    .empty { text-align: center !important; color: #64748b; }
    .totals {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 24px;
      align-items: start;
    }
    .total-table td { border: 0; padding: 8px 0; }
    .total-table td:first-child { color: #475569; font-weight: 700; }
    .total-table td:last-child { text-align: right; font-weight: 800; }
    .grand td {
      border-top: 2px solid #111827;
      padding-top: 13px;
      font-size: 22px;
      color: #111827;
    }
    .note {
      padding: 18px 30px 26px;
      color: #334155;
      font-size: 15px;
      line-height: 1.45;
      background: #f8fafc;
    }
    .footer {
      padding: 14px 30px 22px;
      color: #64748b;
      font-size: 12px;
      text-align: center;
    }
    @media print {
      .quote { border-radius: 0; }
    }
  </style>
</head>
<body>
  <main class="quote">
    <header class="header">
      <div class="brand">
        <img class="logo" src="${escapePrintHtml(logoUrl)}" alt="Green Hills Supply" />
        <div class="company-contact">
          ${companyContactLines.map((line) => `<div>${escapePrintHtml(line)}</div>`).join("")}
        </div>
      </div>
      <div class="title">
        <h1>Quote</h1>
        <div class="date">${escapePrintHtml(quoteDate)}</div>
      </div>
    </header>

    <section class="section grid">
      <div>
        <div class="label">Customer</div>
        <div class="box">
          ${customerLines.map((line) => `<div>${escapePrintHtml(line)}</div>`).join("") || "<div>Customer information not provided</div>"}
        </div>
      </div>
      <div>
        <div class="label">Delivery Address</div>
        <div class="box">
          ${addressLines.map((line) => `<div>${escapePrintHtml(line)}</div>`).join("") || "<div>Address not provided</div>"}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="label">Products</div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>
    </section>

    <section class="section totals">
      <div>
        <div class="label">Delivery Details</div>
        <div class="box">
          <strong>${escapePrintHtml(deliveryQuote.serviceName || "Delivery")}</strong>
          ${etaLine}
          <div>${escapePrintHtml(deliveryQuote.description || "Standard delivery pricing")}</div>
          <div>Pricing: ${escapePrintHtml(pricing.pricingLabel || "Customer")}</div>
        </div>
      </div>
      <table class="total-table">
        <tbody>
          <tr><td>Product Total</td><td>${escapePrintHtml(formatPrintMoney(pricing.productsSubtotal))}</td></tr>
          <tr><td>${escapePrintHtml(actionData?.shippingCalculationText ? "Shipping" : "Delivery")}</td><td>${escapePrintHtml(formatPrintMoney(pricing.deliveryAmount))}</td></tr>
          <tr><td>Tax</td><td>${escapePrintHtml(formatPrintMoney(pricing.taxAmount))}</td></tr>
          <tr class="grand"><td>Total</td><td>${escapePrintHtml(formatPrintMoney(pricing.totalAmount))}</td></tr>
        </tbody>
      </table>
    </section>

    <div class="note">Please let us know if you have any questions or would like to proceed with your order.</div>
    <div class="footer">Green Hills Supply</div>
  </main>
</body>
</html>`;
}

function getBrowserGoogleMapsApiKey() {
  return (
    process.env.GOOGLE_MAPS_BROWSER_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ""
  );
}

export async function loader({ request }: any) {
  const url = new URL(request.url);

  if (url.searchParams.get("logout") === "1") {
    return redirect("/custom-quote", {
      headers: [
        ["Set-Cookie", await userAuthCookie.serialize("", { maxAge: 0 })],
        ["Set-Cookie", await adminQuoteCookie.serialize("", { maxAge: 0 })],
      ],
    });
  }

  const allowed = await hasAdminQuotePermissionAccess(request, "quoteTool");
  if (!allowed) {
    return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const [products, recentQuotes, currentUser] = allowed
    ? await Promise.all([
        getProductOptionsFromSupabase(),
        getRecentCustomQuotes(15),
        getCurrentUser(request),
      ])
    : [[], [], null];

  return data({
    allowed,
    currentUser,
    products,
    b2bCompanies: await loadDispatchB2BCompanies(),
    recentQuotes,
    googleMapsApiKey: getBrowserGoogleMapsApiKey(),
  });
}

export async function action({ request }: any) {
  const url = new URL(request.url);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  const allowed = await hasAdminQuotePermissionAccess(request, "quoteTool");
  if (!allowed) {
    return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const [products, recentQuotes] = await Promise.all([
    getProductOptionsFromSupabase(),
    getRecentCustomQuotes(15),
  ]);

  const customerName = String(form.get("customerName") || "");
  const companyName = String(form.get("companyName") || "").trim();
  const shopifyCompanyId = String(form.get("shopifyCompanyId") || "").trim();
  const shopifyCompanyContactId = String(form.get("shopifyCompanyContactId") || "").trim();
  const shopifyCompanyLocationId = String(form.get("shopifyCompanyLocationId") || "").trim();
  const paymentTermsName = String(form.get("paymentTermsName") || "").trim();
  const paymentTermsTemplateId = String(form.get("paymentTermsTemplateId") || "").trim();
  const parsedPaymentTermsDueInDays = Number(String(form.get("paymentTermsDueInDays") || "").trim());
  const paymentTermsDueInDays = Number.isFinite(parsedPaymentTermsDueInDays)
    ? parsedPaymentTermsDueInDays
    : null;
  const customerEmail = String(form.get("customerEmail") || "").trim();
  const customerPhone = String(form.get("customerPhone") || "").trim();
  const taxExempt = String(form.get("taxExempt") || "") === "1";
  const billingAddress1 = String(form.get("billingAddress1") || "");
  const billingAddress2 = String(form.get("billingAddress2") || "");
  const billingCity = String(form.get("billingCity") || "");
  const billingProvince = String(form.get("billingProvince") || "");
  const billingPostalCode = String(form.get("billingPostalCode") || "");
  const billingCountry = String(form.get("billingCountry") || "US");
  const address1 = String(form.get("address1") || "");
  const address2 = String(form.get("address2") || "");
  const city = String(form.get("city") || "");
  const province = String(form.get("province") || "");
  const postalCode = String(form.get("postalCode") || "");
  const country = String(form.get("country") || "US");
  const quoteAudience = normalizeQuoteAudience(form.get("quoteAudience"));
  const contractorTier = normalizeContractorTier(form.get("contractorTier"));
  const pricingLabel = getPricingLabel(quoteAudience, contractorTier);
  const customDeliveryAmountInput = String(form.get("customDeliveryAmount") || "").trim();
  const customRatePerMinuteInput = String(form.get("customRatePerMinute") || "").trim();
  const customTaxRateInput = String(form.get("customTaxRate") || "").trim();
  const customNotes = String(form.get("customNotes") || "").trim();
  const customShippingQuantityInput = String(form.get("customShippingQuantity") || "").trim();
  const customShippingUnit = String(form.get("customShippingUnit") || "miles").trim() === "hours"
    ? "hours"
    : "miles";
  const customShippingRateInput = String(form.get("customShippingRate") || "").trim();
  const customDeliveryAmountValue = Number(customDeliveryAmountInput);
  const customRatePerMinuteValue = Number(customRatePerMinuteInput);
  const customTaxRateValue = Number(customTaxRateInput);
  const customShippingQuantityValue = Number(customShippingQuantityInput);
  const customShippingRateValue = Number(customShippingRateInput);
  const hasCustomShippingCalculation =
    quoteAudience === "custom" &&
    customShippingQuantityInput !== "" &&
    customShippingRateInput !== "" &&
    Number.isFinite(customShippingQuantityValue) &&
    Number.isFinite(customShippingRateValue);
  const customRatePerMinute =
    quoteAudience === "custom" &&
    customRatePerMinuteInput !== "" &&
    Number.isFinite(customRatePerMinuteValue) &&
    customRatePerMinuteValue > 0
      ? customRatePerMinuteValue
      : undefined;
  const rawLines = JSON.parse(String(form.get("linesJson") || "[]"));

  if (quoteAudience === "contractor" && !companyName) {
    return data(
      {
        allowed: true,
        products,
        recentQuotes,
        ok: false,
        message: "Company Name is required for contractor quotes.",
        customerName,
        companyName,
        customerEmail,
        customerPhone,
        taxExempt,
        billingAddress: { billingAddress1, billingAddress2, billingCity, billingProvince, billingPostalCode, billingCountry },
        address: { address1, address2, city, province, postalCode, country },
        quoteAudience,
        contractorTier,
        customDeliveryAmount: customDeliveryAmountInput,
        customRatePerMinute: customRatePerMinuteInput,
        customTaxRate: customTaxRateInput,
        customShippingQuantity: customShippingQuantityInput,
        customShippingUnit,
        customShippingRate: customShippingRateInput,
        customNotes,
        googleMapsApiKey: getBrowserGoogleMapsApiKey(),
      },
      { status: 400 },
    );
  }

  const selectedProducts = rawLines
    .map((line: any) => {
      const sku = String(line?.sku || "").trim();
      const quantity = Number(line?.quantity || 0);
      const product = products.find((p) => p.sku === sku);
      const baseUnitPrice = product
        ? getUnitPriceForProduct(product, quoteAudience, contractorTier)
        : 0;
      const overrideTitle = String(line?.customTitle || "").trim();
      const rawCustomPrice = String(line?.customPrice || "").trim();
      const overridePrice =
        quoteAudience === "custom" && rawCustomPrice !== ""
          ? Number(rawCustomPrice)
          : null;
      const unitPrice =
        overridePrice !== null && Number.isFinite(overridePrice)
          ? overridePrice
          : baseUnitPrice;

      if (!sku || quantity <= 0 || !product) return null;

      return {
        title: overrideTitle || product.title,
        sku: product.sku,
        vendor: product.vendor,
        unitLabel: product.unitLabel || "",
        quantity,
        price: unitPrice,
      };
    })
    .filter(Boolean) as Array<{
    title: string;
    sku: string;
    vendor: string;
    unitLabel?: string;
    quantity: number;
    price: number;
  }>;

  if (selectedProducts.length === 0) {
    return data(
      {
        allowed: true,
        products,
        recentQuotes,
        ok: false,
        message:
          "Add at least one product line with a selected product and quantity greater than 0.",
        customerName,
        companyName,
        customerEmail,
        customerPhone,
        taxExempt,
        billingAddress: { billingAddress1, billingAddress2, billingCity, billingProvince, billingPostalCode, billingCountry },
        address: { address1, address2, city, province, postalCode, country },
        quoteAudience,
        contractorTier,
        customDeliveryAmount: customDeliveryAmountInput,
        customRatePerMinute: customRatePerMinuteInput,
        customTaxRate: customTaxRateInput,
        customShippingQuantity: customShippingQuantityInput,
        customShippingUnit,
        customShippingRate: customShippingRateInput,
        customNotes,
        googleMapsApiKey: getBrowserGoogleMapsApiKey(),
      },
      { status: 400 },
    );
  }

  if (!address1 || !city || !province || !postalCode) {
    return data(
      {
        allowed: true,
        products,
        recentQuotes,
        ok: false,
        message: "Address 1, city, state, and ZIP are required.",
        customerName,
        companyName,
        customerEmail,
        customerPhone,
        taxExempt,
        billingAddress: { billingAddress1, billingAddress2, billingCity, billingProvince, billingPostalCode, billingCountry },
        address: { address1, address2, city, province, postalCode, country },
        quoteAudience,
        contractorTier,
        customDeliveryAmount: customDeliveryAmountInput,
        customRatePerMinute: customRatePerMinuteInput,
        customTaxRate: customTaxRateInput,
        customShippingQuantity: customShippingQuantityInput,
        customShippingUnit,
        customShippingRate: customShippingRateInput,
        customNotes,
        googleMapsApiKey: getBrowserGoogleMapsApiKey(),
      },
      { status: 400 },
    );
  }

  const shop = process.env.SHOPIFY_STORE_DOMAIN || "darfaz-2e.myshopify.com";

  const deliveryQuote = await getQuote({
    shop,
    postalCode,
    country,
    province,
    city,
    address1,
    address2,
    ratePerMinute: customRatePerMinute,
    items: selectedProducts.map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      requiresShipping: true,
      pickupVendor: item.vendor,
      price: item.price,
    })),
  });

  const productsSubtotal = selectedProducts.reduce(
    (sum, item) => sum + Number(item.price || 0) * item.quantity,
    0,
  );

  const deliveryAmount = Number(deliveryQuote.cents || 0) / 100;
  const effectiveDeliveryAmount =
    hasCustomShippingCalculation
      ? customShippingQuantityValue * customShippingRateValue
      : quoteAudience === "custom" && customDeliveryAmountInput !== ""
      ? (Number.isFinite(customDeliveryAmountValue)
          ? customDeliveryAmountValue
          : deliveryAmount)
      : deliveryAmount;
  const taxRate =
    taxExempt
      ? 0
      :
    quoteAudience === "custom" && customTaxRateInput !== ""
      ? (Number.isFinite(customTaxRateValue)
          ? customTaxRateValue
          : getConfiguredQuoteTaxRate())
      : getConfiguredQuoteTaxRate();
  const taxAmount = productsSubtotal * taxRate;
  const totalAmount = productsSubtotal + effectiveDeliveryAmount + taxAmount;
  const effectiveServiceName = deliveryQuote.serviceName;
  const effectiveEta = deliveryQuote.eta;
  const effectiveSummary = deliveryQuote.summary;
  const effectiveDescription =
    quoteAudience === "custom" && customNotes
      ? customNotes
      : deliveryQuote.description;
  const shippingCalculationText = hasCustomShippingCalculation
    ? `${customShippingQuantityValue.toFixed(2)} ${customShippingUnit} x $${customShippingRateValue.toFixed(2)} = $${effectiveDeliveryAmount.toFixed(2)}`
    : null;
  const savedShippingDetails =
    shippingCalculationText || `Delivery Fee: $${effectiveDeliveryAmount.toFixed(2)}`;

  const sourceBreakdown = getSourceBreakdown(selectedProducts);

  let savedQuoteId: string | null = null;

  if (intent === "save") {
    const currentUser = await getCurrentUser(request);
    const saved = await saveCustomQuote({
      shop,
      customerName,
      companyName,
      customerEmail,
      customerPhone,
      shopifyCompanyId,
      shopifyCompanyContactId,
      shopifyCompanyLocationId,
      paymentTermsName,
      paymentTermsTemplateId,
      paymentTermsDueInDays,
      taxExempt,
      billingAddress1,
      billingAddress2,
      billingCity,
      billingProvince,
      billingPostalCode,
      billingCountry,
      address1,
      address2,
      city,
      province,
      postalCode,
      country,
      quoteTotalCents: Math.round(totalAmount * 100),
      serviceName: effectiveServiceName,
      shippingDetails: savedShippingDetails,
      description: `${effectiveDescription} Pricing: ${pricingLabel}.`,
      eta: effectiveEta,
      summary: undefined,
      createdByUserId: currentUser?.id || null,
      createdByName: currentUser?.name || currentUser?.email || "Legacy admin",
      createdByEmail: currentUser?.email || null,
      sourceBreakdown,
      lineItems: selectedProducts.map((product) => ({
        ...product,
        variantId:
          products.find((entry) => entry.sku === product.sku)?.variantId || null,
        audience: quoteAudience,
        contractorTier: quoteAudience === "contractor" ? contractorTier : null,
        pricingLabel,
      })),
    });

    savedQuoteId = saved.id;

    await logAuditEvent({
      actor: currentUser,
      action: "create_quote",
      targetType: "quote",
      targetId: saved.id,
      targetLabel: customerName || customerEmail || saved.id,
      details: {
        customerName,
        customerEmail,
        totalCents: Math.round(totalAmount * 100),
        audience: quoteAudience,
        contractorTier: quoteAudience === "contractor" ? contractorTier : null,
      },
    });
  }

  return data({
    allowed: true,
    products,
    recentQuotes,
    ok: true,
    customerName,
    companyName,
    shopifyCompanyId,
    shopifyCompanyContactId,
    shopifyCompanyLocationId,
    paymentTermsName,
    paymentTermsTemplateId,
    paymentTermsDueInDays,
    customerEmail,
    customerPhone,
    taxExempt,
    billingAddress: { billingAddress1, billingAddress2, billingCity, billingProvince, billingPostalCode, billingCountry },
    address: { address1, address2, city, province, postalCode, country },
    googleMapsApiKey: getBrowserGoogleMapsApiKey(),
    savedQuoteId,
    selectedLines: selectedProducts,
    sourceBreakdown,
    pricing: {
      pricingLabel,
      productsSubtotal,
      deliveryAmount: effectiveDeliveryAmount,
      taxRate,
      taxAmount,
      totalAmount,
    },
    deliveryQuote: {
      ...deliveryQuote,
      serviceName: effectiveServiceName,
      eta: effectiveEta,
      summary: effectiveSummary,
      description: effectiveDescription,
      cents: Math.round(effectiveDeliveryAmount * 100),
    },
    quoteAudience,
    contractorTier,
    customDeliveryAmount: customDeliveryAmountInput,
    customRatePerMinute: customRatePerMinuteInput,
    customTaxRate: customTaxRateInput,
    customShippingQuantity: customShippingQuantityInput,
    customShippingUnit,
    customShippingRate: customShippingRateInput,
    shippingCalculationText,
    customNotes,
  });
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, #1f2937 0%, #111827 45%, #030712 100%)",
    color: "#f9fafb",
    padding: "32px 20px 60px",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  } as const,
  shell: {
    maxWidth: "1280px",
    margin: "0 auto",
  } as const,
  hero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "20px",
    marginBottom: "24px",
    flexWrap: "wrap" as const,
  },
  title: {
    margin: 0,
    fontSize: "34px",
    fontWeight: 800,
    letterSpacing: "-0.02em",
  },
  subtitle: {
    marginTop: "8px",
    color: "#9ca3af",
    fontSize: "15px",
  },
  logout: {
    color: "#cbd5e1",
    textDecoration: "none",
    border: "1px solid #374151",
    background: "rgba(17, 24, 39, 0.75)",
    padding: "10px 14px",
    borderRadius: "10px",
    fontWeight: 600,
  } as const,
  card: {
    background: "rgba(17, 24, 39, 0.88)",
    border: "1px solid #1f2937",
    borderRadius: "18px",
    padding: "22px",
    boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
    backdropFilter: "blur(10px)",
  } as const,
  sectionTitle: {
    margin: "0 0 14px 0",
    fontSize: "20px",
    fontWeight: 700,
    color: "#f8fafc",
  },
  sectionSub: {
    margin: "0 0 18px 0",
    color: "#9ca3af",
    fontSize: "14px",
  },
  label: {
    display: "block",
    fontSize: "13px",
    fontWeight: 600,
    color: "#d1d5db",
    marginBottom: "6px",
  },
  input: {
    width: "100%",
    background: "#0f172a",
    color: "#f8fafc",
    border: "1px solid #334155",
    borderRadius: "12px",
    padding: "12px 14px",
    fontSize: "14px",
    outline: "none",
  } as const,
  buttonPrimary: {
    background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
    color: "#fff",
    border: "none",
    borderRadius: "12px",
    padding: "12px 18px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(37, 99, 235, 0.35)",
  } as const,
  buttonSecondary: {
    background: "#0f766e",
    color: "#fff",
    border: "none",
    borderRadius: "12px",
    padding: "12px 18px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(15, 118, 110, 0.35)",
  } as const,
  buttonGhost: {
    background: "#111827",
    color: "#e5e7eb",
    border: "1px solid #374151",
    borderRadius: "12px",
    padding: "12px 18px",
    fontWeight: 600,
    cursor: "pointer",
  } as const,
  tabRow: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap" as const,
    marginBottom: "18px",
  },
  tabButton: {
    borderRadius: "999px",
    padding: "10px 16px",
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#cbd5e1",
    cursor: "pointer",
    fontWeight: 700,
  } as const,
  tabButtonActive: {
    background: "linear-gradient(135deg, #0f766e 0%, #115e59 100%)",
    color: "#f0fdfa",
    border: "1px solid #14b8a6",
    boxShadow: "0 10px 24px rgba(20, 184, 166, 0.2)",
  } as const,
  statusOk: {
    marginTop: "18px",
    padding: "14px 16px",
    borderRadius: "14px",
    background: "rgba(22, 163, 74, 0.15)",
    border: "1px solid rgba(34, 197, 94, 0.5)",
    color: "#dcfce7",
  } as const,
  statusErr: {
    marginTop: "18px",
    padding: "14px 16px",
    borderRadius: "14px",
    background: "rgba(220, 38, 38, 0.15)",
    border: "1px solid rgba(248, 113, 113, 0.5)",
    color: "#fee2e2",
  } as const,
};

export default function PublicCustomQuotePage() {
  const loaderData = useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>() as any;
  const draftOrderFetcher = useFetcher<any>();
  const deleteQuoteFetcher = useFetcher<any>();
  const navigation = useNavigation();
  const location = useLocation();
  const isSubmitting = navigation.state === "submitting";

  const allowed = actionData?.allowed ?? loaderData.allowed;
  const products = actionData?.products ?? loaderData.products ?? [];
  const b2bCompanies = (actionData?.b2bCompanies ?? loaderData.b2bCompanies ?? []) as DispatchB2BCompany[];
  const currentUser = actionData?.currentUser ?? loaderData.currentUser ?? null;
  const recentQuotes = (actionData?.recentQuotes ??
    loaderData.recentQuotes ??
    []) as SavedQuoteRecord[];
  const googleMapsApiKey =
    actionData?.googleMapsApiKey ?? loaderData.googleMapsApiKey ?? "";
  const embeddedQs = location.search || "";
  const isEmbeddedRoute = location.pathname.startsWith("/app/");
  const urlParams = new URLSearchParams(location.search);
  const initialAudience = normalizeQuoteAudience(urlParams.get("audience"));
  const initialTier = normalizeContractorTier(urlParams.get("tier"));
  const createDraftOrderAction = location.pathname.startsWith("/app/")
    ? `/app/api/create-draft-order${embeddedQs}`
    : `/api/create-draft-order${embeddedQs}`;
  const deleteQuoteAction = location.pathname.startsWith("/app/")
    ? `/app/api/delete-quote${embeddedQs}`
    : `/api/delete-quote${embeddedQs}`;
  const quoteReviewHref = isEmbeddedRoute ? "/app/quote-review" : "/quote-review";
  const dispatchHref = "/";
  const logoutHref = isEmbeddedRoute ? "/app/custom-quote?logout=1" : "/custom-quote?logout=1";
  const mobileDashboardHref = "/driver";
  const loginHref = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  const canAccess = (permission: string) =>
    !currentUser || currentUser.permissions?.includes(permission);

  const [googleStatus, setGoogleStatus] = useState("Not loaded");
  const [quoteAudience, setQuoteAudience] = useState<QuoteAudience>(
    normalizeQuoteAudience(actionData?.quoteAudience ?? initialAudience),
  );
  const [contractorTier, setContractorTier] = useState<ContractorTier>(
    normalizeContractorTier(actionData?.contractorTier ?? initialTier),
  );
  const [companyName, setCompanyName] = useState(actionData?.companyName || "");
  const [shopifyCompanyId, setShopifyCompanyId] = useState(actionData?.shopifyCompanyId || "");
  const [shopifyCompanyContactId, setShopifyCompanyContactId] = useState(actionData?.shopifyCompanyContactId || "");
  const [shopifyCompanyLocationId, setShopifyCompanyLocationId] = useState(actionData?.shopifyCompanyLocationId || "");
  const [paymentTerms, setPaymentTerms] = useState({
    name: actionData?.paymentTermsName || "",
    templateId: actionData?.paymentTermsTemplateId || "",
    dueInDays: actionData?.paymentTermsDueInDays ? String(actionData.paymentTermsDueInDays) : "",
  });
  const [customerName, setCustomerName] = useState(actionData?.customerName || "");
  const [customerEmail, setCustomerEmail] = useState(actionData?.customerEmail || "");
  const [customerPhone, setCustomerPhone] = useState(actionData?.customerPhone || "");
  const [taxExempt, setTaxExempt] = useState(Boolean(actionData?.taxExempt));
  const [billingAddress, setBillingAddress] = useState({
    billingAddress1: actionData?.billingAddress?.billingAddress1 || "",
    billingAddress2: actionData?.billingAddress?.billingAddress2 || "",
    billingCity: actionData?.billingAddress?.billingCity || "",
    billingProvince: actionData?.billingAddress?.billingProvince || "",
    billingPostalCode: actionData?.billingAddress?.billingPostalCode || "",
    billingCountry: actionData?.billingAddress?.billingCountry || "US",
  });
  const [lines, setLines] = useState<QuoteLine[]>([
    { sku: "", quantity: "", search: "", customTitle: "", customPrice: "" },
  ]);
  const [selectedHistoryQuoteId, setSelectedHistoryQuoteId] = useState<string | null>(
    null,
  );
  const [isMobile, setIsMobile] = useState(false);
  const [historyDetailsOpen, setHistoryDetailsOpen] = useState({
    customer: true,
    lineItems: false,
    sourceBreakdown: false,
  });
  const deferredLines = useDeferredValue(lines);
  const productSearchIndex = useMemo(
    () =>
      products.map((product: QuoteProductOption) => ({
        product,
        haystack: `${product.title} ${product.sku} ${product.vendor}`.toLowerCase(),
      })),
    [products],
  );
  const b2bCompanyByName = useMemo(
    () => new Map(b2bCompanies.map((company) => [company.companyName, company])),
    [b2bCompanies],
  );

  useEffect(() => {
    if (!allowed) return;
    if (!googleMapsApiKey) {
      setGoogleStatus("Missing API key");
      return;
    }

    loadGooglePlaces(googleMapsApiKey)
      .then(() => {
        attachAddressAutocomplete({
          address1Id: "quote-address1",
          cityId: "quote-city",
          provinceId: "quote-province",
          postalCodeId: "quote-postalCode",
          countryId: "quote-country",
        });
        setGoogleStatus("Loaded");
      })
      .catch((error) => {
        console.error("[GOOGLE PLACES LOAD ERROR]", error);
        setGoogleStatus(`Error: ${error.message}`);
      });
  }, [allowed, googleMapsApiKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(max-width: 820px)");
    const updateViewport = () => setIsMobile(media.matches);

    updateViewport();
    media.addEventListener("change", updateViewport);

    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (deleteQuoteFetcher.data?.ok && deleteQuoteFetcher.data?.deletedQuoteId) {
      setSelectedHistoryQuoteId((current) =>
        current === deleteQuoteFetcher.data.deletedQuoteId ? null : current,
      );
    }
  }, [deleteQuoteFetcher.data]);

  useEffect(() => {
    setQuoteAudience(normalizeQuoteAudience(actionData?.quoteAudience ?? initialAudience));
    setContractorTier(normalizeContractorTier(actionData?.contractorTier ?? initialTier));
    setCompanyName(actionData?.companyName || "");
    setShopifyCompanyId(actionData?.shopifyCompanyId || "");
    setShopifyCompanyContactId(actionData?.shopifyCompanyContactId || "");
    setShopifyCompanyLocationId(actionData?.shopifyCompanyLocationId || "");
    setPaymentTerms({
      name: actionData?.paymentTermsName || "",
      templateId: actionData?.paymentTermsTemplateId || "",
      dueInDays: actionData?.paymentTermsDueInDays ? String(actionData.paymentTermsDueInDays) : "",
    });
    setCustomerName(actionData?.customerName || "");
    setCustomerEmail(actionData?.customerEmail || "");
    setCustomerPhone(actionData?.customerPhone || "");
    setTaxExempt(Boolean(actionData?.taxExempt));
    setBillingAddress({
      billingAddress1: actionData?.billingAddress?.billingAddress1 || "",
      billingAddress2: actionData?.billingAddress?.billingAddress2 || "",
      billingCity: actionData?.billingAddress?.billingCity || "",
      billingProvince: actionData?.billingAddress?.billingProvince || "",
      billingPostalCode: actionData?.billingAddress?.billingPostalCode || "",
      billingCountry: actionData?.billingAddress?.billingCountry || "US",
    });
  }, [
    actionData?.quoteAudience,
    actionData?.contractorTier,
    actionData?.companyName,
    actionData?.shopifyCompanyId,
    actionData?.shopifyCompanyContactId,
    actionData?.shopifyCompanyLocationId,
    actionData?.paymentTermsName,
    actionData?.paymentTermsTemplateId,
    actionData?.paymentTermsDueInDays,
    actionData?.customerName,
    actionData?.customerEmail,
    actionData?.customerPhone,
    actionData?.taxExempt,
    actionData?.billingAddress,
    initialAudience,
    initialTier,
  ]);

  function updateBillingAddress(patch: Partial<typeof billingAddress>) {
    setBillingAddress((current) => ({ ...current, ...patch }));
  }

  function applyB2BCompany(company: DispatchB2BCompany) {
    setCompanyName(company.companyName);
    setShopifyCompanyId(company.shopifyCompanyId || "");
    setShopifyCompanyContactId(company.shopifyCompanyContactId || "");
    setShopifyCompanyLocationId(company.shopifyLocationId || "");
    setPaymentTerms({
      name: company.paymentTermsName || "",
      templateId: company.paymentTermsTemplateId || "",
      dueInDays: company.paymentTermsDueInDays ? String(company.paymentTermsDueInDays) : "",
    });
    setCustomerName(company.contactName || "");
    setCustomerEmail(company.email || "");
    setCustomerPhone(company.phone || "");
    setTaxExempt(Boolean(company.taxExempt));
    setBillingAddress({
      billingAddress1: company.billingAddress1 || "",
      billingAddress2: company.billingAddress2 || "",
      billingCity: company.billingCity || "",
      billingProvince: company.billingProvince || "WI",
      billingPostalCode: company.billingPostalCode || "",
      billingCountry: company.billingCountry || "US",
    });
    setContractorTier(company.contractorTier || "tier1");
  }

  const quoteText = useMemo(() => {
    if (!actionData?.pricing || !actionData?.deliveryQuote) return "";

    const linesText =
      actionData.selectedLines
        ?.map(
          (line: any) =>
            `${formatQuantityWithUnit(Number(line.quantity || 0), line.unitLabel)} ${
              line.title
            }: $${(
              Number(line.price || 0) * Number(line.quantity || 0)
            ).toFixed(2)}`,
        )
        .join("\n") || "";

    return [
      linesText,
      `Delivery Fee: $${Number(actionData.pricing.deliveryAmount).toFixed(2)}`,
      `Tax: $${Number(actionData.pricing.taxAmount).toFixed(2)}`,
      `Total: $${Number(actionData.pricing.totalAmount).toFixed(2)}`,
      "",
      "Please let us know if you have any questions or would like to proceed with your order.",
    ]
      .filter(Boolean)
      .join("\n");
  }, [actionData]);

  const selectedHistoryQuote = useMemo(
    () =>
      recentQuotes.find((quote) => quote.id === selectedHistoryQuoteId) || null,
    [recentQuotes, selectedHistoryQuoteId],
  );
  const mobileActionButtonStyle = {
    ...styles.buttonGhost,
    minHeight: isMobile ? 48 : undefined,
    width: isMobile ? "100%" : undefined,
    justifyContent: "center" as const,
  };
  const mobileTabLinkStyle = (active: boolean) =>
    ({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      minHeight: 56,
      borderRadius: 14,
      textDecoration: "none",
      color: active ? "#38bdf8" : "#94a3b8",
      background: active ? "rgba(14, 165, 233, 0.12)" : "transparent",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.01em",
    }) as const;
  const mobileTabIconStyle = (active: boolean) =>
    ({
      width: 24,
      height: 24,
      borderRadius: 999,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: active ? "rgba(14, 165, 233, 0.18)" : "rgba(51, 65, 85, 0.35)",
      color: active ? "#38bdf8" : "#cbd5e1",
      fontSize: 12,
      lineHeight: 1,
    }) as const;
  const mobileBottomNavStyle = {
    position: "fixed" as const,
    left: 12,
    right: 12,
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
    zIndex: 30,
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 20,
    background: "rgba(15, 23, 42, 0.96)",
    border: "1px solid rgba(30, 41, 59, 0.95)",
    boxShadow: "0 18px 38px rgba(2, 6, 23, 0.45)",
    backdropFilter: "blur(14px)",
  };

  function toggleHistorySection(
    key: keyof typeof historyDetailsOpen,
  ) {
    setHistoryDetailsOpen((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  const historyQuoteText = useMemo(() => {
    if (!selectedHistoryQuote) return "";

    const linesText =
      selectedHistoryQuote.line_items
        ?.map((line) => {
          const lineTotal = Number(line.price || 0) * Number(line.quantity || 0);
          return `${line.title} (${line.sku}) x ${line.quantity} — $${lineTotal.toFixed(2)}`;
        })
        .join("\n") || "";

    return [
      `Customer: ${selectedHistoryQuote.customer_name || ""}`,
      `Email: ${selectedHistoryQuote.customer_email || ""}`,
      `Phone: ${selectedHistoryQuote.customer_phone || ""}`,
      `Address: ${selectedHistoryQuote.address1 || ""}, ${selectedHistoryQuote.city || ""}, ${selectedHistoryQuote.province || ""} ${selectedHistoryQuote.postal_code || ""}`,
      `Total: $${(Number(selectedHistoryQuote.quote_total_cents || 0) / 100).toFixed(2)}`,
      `Service: ${selectedHistoryQuote.service_name || ""}`,
      selectedHistoryQuote.shipping_details
        ? `Shipping Details: ${selectedHistoryQuote.shipping_details}`
        : null,
      `ETA: ${selectedHistoryQuote.eta || ""}`,
      `Summary: ${selectedHistoryQuote.summary || ""}`,
      `Notes: ${selectedHistoryQuote.description || ""}`,
      "",
      linesText,
    ]
      .filter(Boolean)
      .join("\n");
  }, [selectedHistoryQuote]);

  function updateLine(index: number, patch: Partial<QuoteLine>) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { sku: "", quantity: "", search: "", customTitle: "", customPrice: "" },
    ]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function filteredProducts(index: number) {
    const search = (deferredLines[index]?.search || "").toLowerCase().trim();
    if (!search) return [];

    return productSearchIndex
      .filter((entry) => entry.haystack.includes(search))
      .map((entry) => entry.product)
      .slice(0, 12);
  }

  function handleQuoteSubmit(event: FormEvent<HTMLFormElement>) {
    if (quoteAudience === "contractor" && !companyName.trim()) {
      event.preventDefault();
      alert("Company Name is required for contractor quotes.");
    }
  }

  async function copyQuote() {
    if (!quoteText) return;
    await navigator.clipboard.writeText(quoteText);
    alert("Quote copied");
  }

  function printQuote() {
    if (!actionData?.pricing || !actionData?.deliveryQuote) return;

    const popup = window.open("", "green-hills-quote-print", "width=900,height=1100");

    if (!popup) {
      alert("Please allow popups to print the quote.");
      return;
    }

    popup.document.write(
      buildPrintableQuoteHtml(
        actionData,
        `${window.location.origin}/email-green-hills-logo.png`,
      ),
    );
    popup.document.close();

    popup.addEventListener("load", () => {
      popup.focus();
      popup.print();
    });
  }

  async function copyHistoryQuote() {
    if (!historyQuoteText) return;
    await navigator.clipboard.writeText(historyQuoteText);
    alert("Saved quote copied");
  }

  if (!allowed) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.shell, maxWidth: "520px" }}>
          <div style={styles.card}>
            <h1 style={styles.title}>Custom Quote Portal</h1>
            <p style={styles.subtitle}>
              Sign in with your contractor user account to access the quote tool.
            </p>
            <a
              href={loginHref}
              style={{
                ...styles.buttonPrimary,
                marginTop: "18px",
                width: "100%",
                minHeight: 48,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                textDecoration: "none",
              }}
            >
              Sign In
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.page,
        padding: isMobile ? "20px 14px 120px" : styles.page.padding,
        overflowX: "clip",
      }}
    >
      <div style={styles.shell}>
        {isMobile ? (
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ ...styles.title, fontSize: "28px" }}>Custom Quote Tool</h1>
            <div style={styles.subtitle}>
              Full quote builder with products, delivery, tax, images, and saved history.
            </div>
            <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
              Loaded products: {products.length} · Google Places: {googleStatus}
            </div>
          </div>
        ) : (
          <div style={styles.hero}>
            <div>
              <h1 style={styles.title}>Custom Quote Tool</h1>
              <div style={styles.subtitle}>
                Full quote builder with products, delivery, tax, images, and saved
                history.
              </div>
              <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
                Loaded products: {products.length} · Google Places: {googleStatus}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {canAccess("quoteTool") ? (
                <a href={mobileDashboardHref} style={styles.logout}>
                  Dashboard
                </a>
              ) : null}
              {canAccess("dispatch") ? (
                <a href={dispatchHref} style={styles.logout}>
                  Dispatch
                </a>
              ) : null}
              {canAccess("reviewQuotes") ? (
                <a href={quoteReviewHref} style={styles.logout}>
                  Review Quotes
                </a>
              ) : null}
              {canAccess("manageUsers") ? (
                <a href="/settings" style={styles.logout}>
                  Settings
                </a>
              ) : null}
              {currentUser ? (
                <a href="/change-password" style={styles.logout}>
                  Change Password
                </a>
              ) : null}
              <a href={currentUser ? "/login?logout=1" : logoutHref} style={styles.logout}>
                Log out
              </a>
            </div>
          </div>
        )}

        <Form method="post" style={{ display: "grid", gap: "22px" }} onSubmit={handleQuoteSubmit}>
          <input type="hidden" name="quoteAudience" value={quoteAudience} />
          <input type="hidden" name="contractorTier" value={contractorTier} />
          <input type="hidden" name="linesJson" value={JSON.stringify(lines)} />
          <input type="hidden" name="taxExempt" value={taxExempt ? "1" : "0"} />
          <input type="hidden" name="shopifyCompanyId" value={shopifyCompanyId} />
          <input type="hidden" name="shopifyCompanyContactId" value={shopifyCompanyContactId} />
          <input type="hidden" name="shopifyCompanyLocationId" value={shopifyCompanyLocationId} />
          <input type="hidden" name="paymentTermsName" value={paymentTerms.name} />
          <input type="hidden" name="paymentTermsTemplateId" value={paymentTerms.templateId} />
          <input type="hidden" name="paymentTermsDueInDays" value={paymentTerms.dueInDays} />
          <datalist id="custom-quote-b2b-companies">
            {b2bCompanies.map((company) => (
              <option key={company.id} value={company.companyName} />
            ))}
          </datalist>

          <div style={{ ...styles.card, padding: isMobile ? "18px" : styles.card.padding }}>
            <h2 style={styles.sectionTitle}>Quote Type</h2>
            <p style={styles.sectionSub}>
              Switch between standard customer pricing and contractor tier pricing.
            </p>

            <div style={styles.tabRow}>
              <button
                type="button"
                onClick={() => setQuoteAudience("customer")}
                style={{
                  ...styles.tabButton,
                  minHeight: isMobile ? 46 : undefined,
                  flex: isMobile ? "1 1 110px" : undefined,
                  textAlign: "center",
                  ...(quoteAudience === "customer" ? styles.tabButtonActive : {}),
                }}
              >
                Customer
              </button>
              <button
                type="button"
                onClick={() => setQuoteAudience("contractor")}
                style={{
                  ...styles.tabButton,
                  minHeight: isMobile ? 46 : undefined,
                  flex: isMobile ? "1 1 110px" : undefined,
                  textAlign: "center",
                  ...(quoteAudience === "contractor" ? styles.tabButtonActive : {}),
                }}
              >
                Contractor
              </button>
              <button
                type="button"
                onClick={() => setQuoteAudience("custom")}
                style={{
                  ...styles.tabButton,
                  minHeight: isMobile ? 46 : undefined,
                  flex: isMobile ? "1 1 110px" : undefined,
                  textAlign: "center",
                  ...(quoteAudience === "custom" ? styles.tabButtonActive : {}),
                }}
              >
                Custom
              </button>
            </div>

            {quoteAudience === "contractor" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "minmax(280px, 1fr) 280px",
                  gap: 14,
                  alignItems: "end",
                }}
              >
                <div>
                  <label style={styles.label}>Company Name</label>
                  <input
                    type="text"
                    name="companyName"
                    list="custom-quote-b2b-companies"
                    autoComplete="organization"
                    required
                    value={companyName}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      setCompanyName(nextName);
                      const company = b2bCompanyByName.get(nextName);
                      if (company) applyB2BCompany(company);
                    }}
                    placeholder="Search Shopify B2B company"
                    style={styles.input}
                  />
                  {taxExempt ? (
                    <div style={{ marginTop: 8, color: "#86efac", fontSize: 13 }}>
                      Tax exempt company selected. Product tax will not be added.
                    </div>
                  ) : null}
                  {paymentTerms.templateId ? (
                    <div style={{ marginTop: 8, color: "#bfdbfe", fontSize: 13 }}>
                      Payment terms: {paymentTerms.name || "Pay later"}
                      {paymentTerms.dueInDays ? ` (${paymentTerms.dueInDays} days)` : ""}
                    </div>
                  ) : null}
                </div>
                <div>
                  <label style={styles.label}>Contractor Tier</label>
                  <select
                    name="contractorTierUi"
                    value={contractorTier}
                    onChange={(e) =>
                      setContractorTier(normalizeContractorTier(e.target.value))
                    }
                    style={styles.input}
                  >
                    <option value="tier1">Tier 1</option>
                    <option value="tier2">Tier 2</option>
                  </select>
                </div>
              </div>
            ) : quoteAudience === "custom" ? (
              <div style={{ color: "#93c5fd", fontSize: 14 }}>
                Custom mode keeps the same quote flow but lets you override line titles,
                unit prices, delivery, shipping math, tax, and notes.
              </div>
            ) : null}
          </div>

          <div style={{ ...styles.card, padding: isMobile ? "18px" : styles.card.padding }}>
            <h2 style={styles.sectionTitle}>Customer & Delivery Address</h2>
            <p style={styles.sectionSub}>
              Start typing the street address and choose a suggestion.
            </p>

            <div style={{ display: "grid", gap: "14px" }}>
              <div>
                <label style={styles.label}>Customer Name</label>
                <input
                  type="text"
                  name="customerName"
                  autoComplete="name"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  style={styles.input}
                />
              </div>

              {quoteAudience === "contractor" ? null : (
                <input type="hidden" name="companyName" value={companyName} />
              )}

              <div>
                <label style={styles.label}>Email Address</label>
                <input
                  type="email"
                  name="customerEmail"
                  autoComplete="email"
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Phone Number</label>
                <input
                  type="tel"
                  name="customerPhone"
                  autoComplete="tel"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  style={styles.input}
                />
              </div>

              {quoteAudience === "contractor" ? (
                <div style={{ display: "grid", gap: "14px" }}>
                  <h3 style={{ ...styles.sectionTitle, fontSize: 18, marginTop: 4 }}>Billing Address</h3>
                  <div>
                    <label style={styles.label}>Billing Address 1</label>
                    <input
                      type="text"
                      name="billingAddress1"
                      value={billingAddress.billingAddress1}
                      onChange={(event) => updateBillingAddress({ billingAddress1: event.target.value })}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <label style={styles.label}>Billing Address 2</label>
                    <input
                      type="text"
                      name="billingAddress2"
                      value={billingAddress.billingAddress2}
                      onChange={(event) => updateBillingAddress({ billingAddress2: event.target.value })}
                      style={styles.input}
                    />
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "1.3fr 0.8fr 0.8fr 0.8fr",
                      gap: "14px",
                    }}
                  >
                    <div>
                      <label style={styles.label}>Billing City</label>
                      <input
                        type="text"
                        name="billingCity"
                        value={billingAddress.billingCity}
                        onChange={(event) => updateBillingAddress({ billingCity: event.target.value })}
                        style={styles.input}
                      />
                    </div>
                    <div>
                      <label style={styles.label}>State</label>
                      <input
                        type="text"
                        name="billingProvince"
                        value={billingAddress.billingProvince}
                        onChange={(event) => updateBillingAddress({ billingProvince: event.target.value })}
                        style={styles.input}
                      />
                    </div>
                    <div>
                      <label style={styles.label}>ZIP</label>
                      <input
                        type="text"
                        name="billingPostalCode"
                        value={billingAddress.billingPostalCode}
                        onChange={(event) => updateBillingAddress({ billingPostalCode: event.target.value })}
                        style={styles.input}
                      />
                    </div>
                    <div>
                      <label style={styles.label}>Country</label>
                      <input
                        type="text"
                        name="billingCountry"
                        value={billingAddress.billingCountry}
                        onChange={(event) => updateBillingAddress({ billingCountry: event.target.value })}
                        style={styles.input}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              <div>
                <label style={styles.label}>Address 1</label>
                <input
                  id="quote-address1"
                  type="text"
                  name="address1"
                  autoComplete="street-address"
                  defaultValue={actionData?.address?.address1 || ""}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Address 2</label>
                <input
                  type="text"
                  name="address2"
                  autoComplete="address-line2"
                  defaultValue={actionData?.address?.address2 || ""}
                  style={styles.input}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile
                    ? "repeat(2, minmax(0, 1fr))"
                    : "1.3fr 0.8fr 0.8fr 0.8fr",
                  gap: "14px",
                }}
              >
                <div>
                  <label style={styles.label}>City</label>
                  <input
                    id="quote-city"
                    type="text"
                    name="city"
                    autoComplete="address-level2"
                    defaultValue={actionData?.address?.city || ""}
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.label}>State</label>
                  <input
                    id="quote-province"
                    type="text"
                    name="province"
                    autoComplete="address-level1"
                    defaultValue={actionData?.address?.province || "WI"}
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.label}>ZIP</label>
                  <input
                    id="quote-postalCode"
                    type="text"
                    name="postalCode"
                    autoComplete="postal-code"
                    defaultValue={actionData?.address?.postalCode || ""}
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.label}>Country</label>
                  <input
                    id="quote-country"
                    type="text"
                    name="country"
                    autoComplete="country-name"
                    defaultValue={actionData?.address?.country || "US"}
                    style={styles.input}
                  />
                </div>
              </div>
            </div>
          </div>

          <div style={{ ...styles.card, padding: isMobile ? "18px" : styles.card.padding }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: isMobile ? "flex-start" : "center",
                gap: "16px",
                marginBottom: "14px",
                flexWrap: "wrap",
              }}
            >
              <div>
                <h2 style={styles.sectionTitle}>Quote Lines</h2>
                <p style={styles.sectionSub}>
                  Search by product, SKU, or vendor. Click a result to select it.
                </p>
              </div>

              <button type="button" onClick={addLine} style={styles.buttonGhost}>
                Add Line
              </button>
            </div>

            <div style={{ display: "grid", gap: "16px" }}>
              {lines.map((line, index) => {
                const selectedProduct = products.find(
                  (p: QuoteProductOption) => p.sku === line.sku,
                );
                const matches = filteredProducts(index);

                return (
                  <div
                    key={index}
                    style={{
                      border: "1px solid #1f2937",
                      background: "rgba(2, 6, 23, 0.72)",
                      borderRadius: "16px",
                      padding: isMobile ? "14px" : "16px",
                      display: "grid",
                      gap: "12px",
                      overflowX: "clip",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "minmax(0, 1fr)"
                          : "minmax(360px, 1fr) 160px 120px",
                        gap: "12px",
                        alignItems: "end",
                      }}
                    >
                      <div>
                        <label style={styles.label}>Search Product</label>
                        <input
                          type="text"
                          value={line.search}
                          onChange={(e) =>
                            updateLine(index, {
                              search: e.target.value,
                              sku: "",
                            })
                          }
                          placeholder="Type product name, SKU, or vendor"
                          style={styles.input}
                        />
                      </div>

                      <div>
                        <label style={styles.label}>Quantity</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(index, { quantity: e.target.value })
                          }
                          style={styles.input}
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        disabled={lines.length === 1}
                        style={{
                          ...styles.buttonGhost,
                          minHeight: isMobile ? 46 : undefined,
                          width: isMobile ? "100%" : undefined,
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    {selectedProduct ? (
                      <div
                      style={{
                        display: "flex",
                        alignItems: isMobile ? "flex-start" : "center",
                        flexWrap: isMobile ? "wrap" : "nowrap",
                        gap: 12,
                        padding: "12px 14px",
                          borderRadius: "12px",
                          background: "rgba(37, 99, 235, 0.12)",
                          border: "1px solid rgba(96, 165, 250, 0.35)",
                          color: "#dbeafe",
                        }}
                      >
                        {selectedProduct.imageUrl ? (
                          <img
                            src={selectedProduct.imageUrl}
                            alt={selectedProduct.title}
                            loading="lazy"
                            decoding="async"
                            style={{
                              width: 52,
                              height: 52,
                              objectFit: "cover",
                              borderRadius: 8,
                              border: "1px solid rgba(255,255,255,0.08)",
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 52,
                              height: 52,
                              borderRadius: 8,
                              background: "#1e293b",
                              border: "1px solid #334155",
                              flexShrink: 0,
                            }}
                          />
                        )}

                        <div>
                          <div style={{ fontWeight: 700 }}>
                            {quoteAudience === "custom" && line.customTitle
                              ? line.customTitle
                              : selectedProduct.title}
                          </div>
                          <div style={{ fontSize: 13, color: "#bfdbfe" }}>
                            {selectedProduct.sku} — {selectedProduct.vendor}
                          </div>
                          <div style={{ fontSize: 13, color: "#bfdbfe" }}>
                            Unit Price: $
                            {(() => {
                              const customPriceValue = Number(line.customPrice || "");
                              const displayPrice =
                                quoteAudience === "custom" &&
                                String(line.customPrice || "").trim() !== "" &&
                                Number.isFinite(customPriceValue)
                                  ? customPriceValue
                                  : getUnitPriceForProduct(
                                      selectedProduct,
                                      quoteAudience,
                                      contractorTier,
                                    );
                              return Number(displayPrice).toFixed(2);
                            })()}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {selectedProduct && quoteAudience === "custom" ? (
                      <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "minmax(0, 1fr)"
                          : "minmax(260px, 1fr) 180px",
                        gap: "12px",
                      }}
                      >
                        <div>
                          <label style={styles.label}>Custom Line Title</label>
                          <input
                            type="text"
                            value={line.customTitle || ""}
                            onChange={(e) =>
                              updateLine(index, { customTitle: e.target.value })
                            }
                            placeholder={selectedProduct.title}
                            style={styles.input}
                          />
                        </div>
                        <div>
                          <label style={styles.label}>Custom Unit Price</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.customPrice || ""}
                            onChange={(e) =>
                              updateLine(index, { customPrice: e.target.value })
                            }
                            placeholder={String(
                              getUnitPriceForProduct(
                                selectedProduct,
                                quoteAudience,
                                contractorTier,
                              ),
                            )}
                            style={styles.input}
                          />
                        </div>
                      </div>
                    ) : null}

                    {!selectedProduct && line.search.trim() ? (
                      <div
                        style={{
                          border: "1px solid #334155",
                          borderRadius: "14px",
                          maxHeight: "280px",
                          overflowY: "auto",
                          background: "#020617",
                        }}
                      >
                        {matches.length === 0 ? (
                          <div style={{ padding: "14px", color: "#94a3b8" }}>
                            No matching products
                          </div>
                        ) : (
                          matches.map((product: QuoteProductOption) => (
                            <button
                              key={product.sku}
                              type="button"
                              onClick={() =>
                                updateLine(index, {
                                  sku: product.sku,
                                  search: `${product.title} (${product.sku}) — ${product.vendor}`,
                                })
                              }
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                width: "100%",
                                textAlign: "left",
                                padding: "14px",
                                border: "none",
                                borderBottom: "1px solid #111827",
                                background: "transparent",
                                color: "#f8fafc",
                                cursor: "pointer",
                              }}
                            >
                              {product.imageUrl ? (
                                <img
                                  src={product.imageUrl}
                                  alt={product.title}
                                  loading="lazy"
                                  decoding="async"
                                  style={{
                                    width: 44,
                                    height: 44,
                                    objectFit: "cover",
                                    borderRadius: 8,
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    flexShrink: 0,
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: 8,
                                    background: "#1e293b",
                                    border: "1px solid #334155",
                                    flexShrink: 0,
                                  }}
                                />
                              )}

                              <div>
                                <div style={{ fontWeight: 700 }}>
                                  {product.title}
                                </div>
                                <div
                                  style={{
                                    fontSize: "13px",
                                    color: "#94a3b8",
                                    marginTop: "4px",
                                  }}
                                >
                                  {product.sku} — {product.vendor}
                                </div>
                                <div
                                  style={{
                                    fontSize: "13px",
                                    color: "#94a3b8",
                                    marginTop: "4px",
                                  }}
                                >
                                  $
                                  {Number(
                                    getUnitPriceForProduct(
                                      product,
                                      quoteAudience,
                                      contractorTier,
                                    ),
                                  ).toFixed(2)}
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {quoteAudience === "custom" ? (
            <div style={{ ...styles.card, padding: isMobile ? "18px" : styles.card.padding }}>
              <h2 style={styles.sectionTitle}>Custom Adjustments</h2>
              <p style={styles.sectionSub}>
                Override delivery, minute charge, tax, and the customer-facing quote details before
                calculating or saving.
              </p>

              <div style={{ display: "grid", gap: "14px" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "minmax(0, 1fr)"
                      : "180px 180px 180px",
                    gap: "14px",
                  }}
                >
                  <div>
                    <label style={styles.label}>Delivery Amount</label>
                    <input
                      type="number"
                      name="customDeliveryAmount"
                      min="0"
                      step="0.01"
                      defaultValue={actionData?.customDeliveryAmount || ""}
                      placeholder="Use calculated delivery"
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Minute Charge</label>
                    <input
                      type="number"
                      name="customRatePerMinute"
                      min="0"
                      step="0.01"
                      defaultValue={actionData?.customRatePerMinute || ""}
                      placeholder="Default 2.08"
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Tax Rate</label>
                    <input
                      type="number"
                      name="customTaxRate"
                      min="0"
                      step="0.0001"
                      defaultValue={actionData?.customTaxRate || ""}
                      placeholder="Example: 0.055"
                      style={styles.input}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "minmax(0, 1fr)"
                      : "160px 160px 180px",
                    gap: "14px",
                  }}
                >
                  <div>
                    <label style={styles.label}>Shipping Qty</label>
                    <input
                      type="number"
                      name="customShippingQuantity"
                      min="0"
                      step="0.01"
                      defaultValue={actionData?.customShippingQuantity || ""}
                      placeholder="Miles or hours"
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Shipping Unit</label>
                    <select
                      name="customShippingUnit"
                      defaultValue={actionData?.customShippingUnit || "miles"}
                      style={styles.input}
                    >
                      <option value="miles">Miles</option>
                      <option value="hours">Hours</option>
                    </select>
                  </div>

                  <div>
                    <label style={styles.label}>Price Per Unit</label>
                    <input
                      type="number"
                      name="customShippingRate"
                      min="0"
                      step="0.01"
                      defaultValue={actionData?.customShippingRate || ""}
                      placeholder="Rate per mile/hour"
                      style={styles.input}
                    />
                  </div>
                </div>

                <div style={{ color: "#93c5fd", fontSize: 13 }}>
                  If shipping quantity and price per unit are both filled in, the
                  delivery amount will use `quantity x rate` and override the manual
                  delivery amount above.
                </div>

                <div>
                  <label style={styles.label}>Notes</label>
                  <textarea
                    name="customNotes"
                    defaultValue={actionData?.customNotes || ""}
                    placeholder="Use calculated notes"
                    style={{
                      ...styles.input,
                      minHeight: 110,
                      resize: "vertical",
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
              flexDirection: isMobile ? "column" : "row",
              position: isMobile ? "sticky" : "static",
              bottom: isMobile ? "calc(env(safe-area-inset-bottom, 0px) + 76px)" : undefined,
              zIndex: isMobile ? 20 : undefined,
              padding: isMobile ? "12px" : 0,
              borderRadius: isMobile ? 16 : undefined,
              background: isMobile ? "rgba(2, 6, 23, 0.92)" : "transparent",
              border: isMobile ? "1px solid rgba(51, 65, 85, 0.9)" : "none",
              boxShadow: isMobile ? "0 18px 32px rgba(2, 6, 23, 0.4)" : "none",
              backdropFilter: isMobile ? "blur(12px)" : "none",
            }}
          >
            <button
              type="submit"
              name="intent"
              value="quote"
              style={{
                ...styles.buttonPrimary,
                width: isMobile ? "100%" : undefined,
                minHeight: isMobile ? 50 : undefined,
              }}
            >
              {isSubmitting ? "Calculating..." : "Get Full Quote"}
            </button>

            <button
              type="submit"
              name="intent"
              value="save"
              style={{
                ...styles.buttonSecondary,
                width: isMobile ? "100%" : undefined,
                minHeight: isMobile ? 50 : undefined,
              }}
            >
              {isSubmitting ? "Saving..." : "Save Quote"}
            </button>
          </div>
        </Form>

        {actionData?.message ? (
          <div
            style={{
              ...(actionData.ok ? styles.statusOk : styles.statusErr),
              fontSize: isMobile ? 16 : undefined,
              fontWeight: isMobile ? 700 : undefined,
            }}
          >
            {actionData.message}
          </div>
        ) : null}

        {actionData?.savedQuoteId ? (
          <div
            style={{
              ...styles.statusOk,
              fontSize: isMobile ? 16 : undefined,
              fontWeight: isMobile ? 700 : undefined,
            }}
          >
            Quote saved successfully. ID: {actionData.savedQuoteId}
          </div>
        ) : null}

        {actionData?.pricing && actionData?.deliveryQuote ? (
          <div
            style={{
              marginTop: "24px",
              display: "grid",
              gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "1.2fr 1fr",
              gap: "20px",
            }}
          >
            <div style={{ ...styles.card, padding: isMobile ? "18px" : styles.card.padding }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: isMobile ? "flex-start" : "center",
                  flexWrap: "wrap",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <h2 style={{ ...styles.sectionTitle, margin: 0 }}>
                  Full Quote Result
                </h2>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" onClick={copyQuote} style={styles.buttonGhost}>
                    Copy Quote
                  </button>
                  <button type="button" onClick={printQuote} style={styles.buttonGhost}>
                    Print Quote
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gap: "10px", color: "#e5e7eb" }}>
                <div>
                  <strong style={{ color: "#93c5fd" }}>Pricing:</strong>{" "}
                  {actionData.pricing.pricingLabel}
                </div>
                <div>
                  <strong style={{ color: "#93c5fd" }}>Products:</strong> $
                  {Number(actionData.pricing.productsSubtotal).toFixed(2)}
                </div>
                <div>
                  <strong style={{ color: "#93c5fd" }}>
                    {actionData.shippingCalculationText ? "Shipping:" : "Delivery:"}
                  </strong>{" "}
                  ${Number(actionData.pricing.deliveryAmount).toFixed(2)}
                </div>
                {actionData.shippingCalculationText ? (
                  <div>
                    <strong style={{ color: "#93c5fd" }}>Shipping Calc:</strong>{" "}
                    {actionData.shippingCalculationText}
                  </div>
                ) : null}
                <div>
                  <strong style={{ color: "#93c5fd" }}>Tax:</strong> $
                  {Number(actionData.pricing.taxAmount).toFixed(2)}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 10,
                    borderTop: "1px solid #334155",
                    fontSize: isMobile ? 22 : 18,
                    fontWeight: 800,
                  }}
                >
                  TOTAL: ${Number(actionData.pricing.totalAmount).toFixed(2)}
                </div>

                <div style={{ marginTop: 14 }}>
                  <strong style={{ color: "#93c5fd" }}>Delivery Service:</strong>{" "}
                  {actionData.deliveryQuote.serviceName}
                </div>
                <div>
                  <strong style={{ color: "#93c5fd" }}>ETA:</strong>{" "}
                  {actionData.deliveryQuote.eta}
                </div>
                <div>
                  <strong style={{ color: "#93c5fd" }}>
                    {actionData.shippingCalculationText ? "Custom Shipping:" : "Notes:"}
                  </strong>{" "}
                  {actionData.deliveryQuote.description}
                </div>
              </div>
            </div>

            <div style={{ ...styles.card, padding: isMobile ? "18px" : styles.card.padding }}>
              <h2 style={styles.sectionTitle}>Source Breakdown</h2>
              <div style={{ display: "grid", gap: "12px" }}>
                {actionData.sourceBreakdown?.map((source: any, index: number) => (
                  <div
                    key={`${source.vendor}-${index}`}
                    style={{
                      border: "1px solid #1f2937",
                      borderRadius: "12px",
                      padding: "14px",
                      background: "rgba(2, 6, 23, 0.72)",
                    }}
                  >
                    <div style={{ fontWeight: 700, color: "#f8fafc" }}>
                      {source.vendor}
                    </div>
                    <div style={{ color: "#93c5fd", marginTop: "4px" }}>
                      Total Qty: {source.quantity}
                    </div>
                    <div
                      style={{
                        color: "#9ca3af",
                        marginTop: "8px",
                        fontSize: "14px",
                      }}
                    >
                      {source.items.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {recentQuotes.length ? (
          <div
            style={{
              ...styles.card,
              marginTop: 24,
              padding: isMobile ? "18px" : styles.card.padding,
            }}
          >
            <h2 style={styles.sectionTitle}>Recent Quotes</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {recentQuotes.map((quote: any) => (
                <button
                  key={quote.id}
                  type="button"
                  onClick={() => setSelectedHistoryQuoteId(quote.id)}
                  style={{
                    textAlign: "left",
                    width: "100%",
                    border: "1px solid #1f2937",
                    borderRadius: 12,
                    padding: isMobile ? 16 : 14,
                    background: "rgba(2, 6, 23, 0.72)",
                    color: "#f8fafc",
                    cursor: "pointer",
                    overflowWrap: "anywhere",
                    minHeight: isMobile ? 88 : undefined,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {quote.customer_name || "Unnamed customer"}
                  </div>
                  <div style={{ color: "#93c5fd", marginTop: 4 }}>
                    ${(quote.quote_total_cents / 100).toFixed(2)} —{" "}
                    {quote.service_name || "Quote"}
                  </div>
                  <div style={{ color: "#9ca3af", marginTop: 6, fontSize: 14 }}>
                    {quote.address1}, {quote.city}, {quote.province}{" "}
                    {quote.postal_code}
                  </div>
                  <div style={{ color: "#64748b", marginTop: 6, fontSize: 12 }}>
                    {new Date(quote.created_at).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {selectedHistoryQuote ? (
          <div
            style={{
              ...styles.card,
              marginTop: 24,
              padding: isMobile ? "18px" : styles.card.padding,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: isMobile ? "flex-start" : "center",
                flexWrap: "wrap",
                gap: "12px",
                marginBottom: "16px",
              }}
            >
              <div>
                <h2 style={{ ...styles.sectionTitle, margin: 0 }}>Saved Quote Detail</h2>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
                  {new Date(selectedHistoryQuote.created_at).toLocaleString()}
                </div>
                <div style={{ color: "#93c5fd", fontSize: 13, marginTop: 6 }}>
                  Created by{" "}
                  {selectedHistoryQuote.created_by_name ||
                    selectedHistoryQuote.created_by_email ||
                    "Unknown user"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={copyHistoryQuote}
                  style={mobileActionButtonStyle}
                >
                  Copy Saved Quote
                </button>
                <deleteQuoteFetcher.Form
                  method="post"
                  action={deleteQuoteAction}
                  onSubmit={(event) => {
                    if (!window.confirm("Delete this quote? This can't be undone.")) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="quoteId" value={selectedHistoryQuote.id} />
                  <button type="submit" style={mobileActionButtonStyle}>
                    {deleteQuoteFetcher.state === "submitting"
                      ? "Deleting..."
                      : "Delete Quote"}
                  </button>
                </deleteQuoteFetcher.Form>
              </div>
            </div>

            {canAccess("sendToShopify") ? (
              <draftOrderFetcher.Form
                method="post"
                action={createDraftOrderAction}
                style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}
              >
                <input type="hidden" name="quoteId" value={selectedHistoryQuote.id} />
                <button type="submit" style={styles.buttonPrimary}>
                  {draftOrderFetcher.state === "submitting"
                    ? "Creating Draft Order..."
                    : "Send To Shopify"}
                </button>
                {draftOrderFetcher.data?.draftOrderAdminUrl ? (
                  <a
                    href={draftOrderFetcher.data.draftOrderAdminUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={mobileActionButtonStyle}
                  >
                    Open Draft Order
                  </a>
                ) : null}
                {draftOrderFetcher.data?.draftOrderInvoiceUrl ? (
                  <a
                    href={draftOrderFetcher.data.draftOrderInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={mobileActionButtonStyle}
                  >
                    Open Invoice
                  </a>
                ) : null}
              </draftOrderFetcher.Form>
            ) : null}

                {draftOrderFetcher.data?.message ? (
                  <div
                    style={{
                      ...(draftOrderFetcher.data.ok ? styles.statusOk : styles.statusErr),
                      fontSize: isMobile ? 16 : undefined,
                      fontWeight: isMobile ? 700 : undefined,
                    }}
                  >
                    {draftOrderFetcher.data.message}
                  </div>
                ) : null}

                {deleteQuoteFetcher.data?.message ? (
                  <div
                    style={{
                      ...(deleteQuoteFetcher.data.ok ? styles.statusOk : styles.statusErr),
                      fontSize: isMobile ? 16 : undefined,
                      fontWeight: isMobile ? 700 : undefined,
                    }}
                  >
                    {deleteQuoteFetcher.data.message}
                  </div>
                ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "1.2fr 1fr",
                gap: "20px",
              }}
            >
              <div style={{ display: "grid", gap: "10px", color: "#e5e7eb" }}>
                <button
                  type="button"
                  onClick={() => toggleHistorySection("customer")}
                  style={mobileActionButtonStyle}
                >
                  {historyDetailsOpen.customer ? "Hide Quote Info" : "Show Quote Info"}
                </button>
                {historyDetailsOpen.customer ? (
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div>
                      <strong style={{ color: "#93c5fd" }}>Customer:</strong>{" "}
                      {selectedHistoryQuote.customer_name || "Unnamed customer"}
                    </div>
                    <div>
                      <strong style={{ color: "#93c5fd" }}>Email:</strong>{" "}
                      {selectedHistoryQuote.customer_email || "N/A"}
                    </div>
                    <div>
                      <strong style={{ color: "#93c5fd" }}>Phone:</strong>{" "}
                      {selectedHistoryQuote.customer_phone || "N/A"}
                    </div>
                    <div>
                      <strong style={{ color: "#93c5fd" }}>Address:</strong>{" "}
                      {selectedHistoryQuote.address1}, {selectedHistoryQuote.city},{" "}
                      {selectedHistoryQuote.province} {selectedHistoryQuote.postal_code}
                    </div>
                    <div style={{ fontSize: isMobile ? 22 : undefined, fontWeight: isMobile ? 800 : undefined }}>
                      <strong style={{ color: "#93c5fd" }}>Total:</strong> $
                      {(Number(selectedHistoryQuote.quote_total_cents || 0) / 100).toFixed(2)}
                    </div>
                    <div>
                      <strong style={{ color: "#93c5fd" }}>Service:</strong>{" "}
                      {selectedHistoryQuote.service_name || "Quote"}
                    </div>
                    <div>
                      <strong style={{ color: "#93c5fd" }}>ETA:</strong>{" "}
                      {selectedHistoryQuote.eta || "N/A"}
                    </div>
                    {selectedHistoryQuote.shipping_details ? (
                      <div>
                        <strong style={{ color: "#93c5fd" }}>Shipping Details:</strong>{" "}
                        {selectedHistoryQuote.shipping_details}
                      </div>
                    ) : null}
                    <div>
                      <strong style={{ color: "#93c5fd" }}>Summary:</strong>{" "}
                      {selectedHistoryQuote.summary || "N/A"}
                    </div>
                    <div>
                      <strong style={{ color: "#93c5fd" }}>Notes:</strong>{" "}
                      {selectedHistoryQuote.description || "N/A"}
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => toggleHistorySection("lineItems")}
                    style={mobileActionButtonStyle}
                  >
                    {historyDetailsOpen.lineItems ? "Hide Line Items" : "Show Line Items"}
                  </button>
                  {historyDetailsOpen.lineItems ? (
                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      {(selectedHistoryQuote.line_items || []).map((line, index) => (
                        <div
                          key={`${line.sku}-${index}`}
                          style={{
                            border: "1px solid #1f2937",
                            borderRadius: 12,
                            padding: 12,
                            background: "rgba(2, 6, 23, 0.72)",
                            overflowWrap: "anywhere",
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>{line.title}</div>
                          <div style={{ color: "#93c5fd", marginTop: 4 }}>
                            {line.sku} · Qty {line.quantity}
                          </div>
                          <div style={{ color: "#9ca3af", marginTop: 4, fontSize: 14 }}>
                            Unit ${Number(line.price || 0).toFixed(2)} · Total $
                            {(Number(line.price || 0) * Number(line.quantity || 0)).toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => toggleHistorySection("sourceBreakdown")}
                  style={mobileActionButtonStyle}
                >
                  {historyDetailsOpen.sourceBreakdown
                    ? "Hide Source Breakdown"
                    : "Show Source Breakdown"}
                </button>
                {historyDetailsOpen.sourceBreakdown ? (
                  <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
                    {(selectedHistoryQuote.source_breakdown || []).map((source, index) => (
                      <div
                        key={`${source.vendor}-${index}`}
                        style={{
                          border: "1px solid #1f2937",
                          borderRadius: "12px",
                          padding: "14px",
                          background: "rgba(2, 6, 23, 0.72)",
                          overflowWrap: "anywhere",
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "#f8fafc" }}>
                          {source.vendor}
                        </div>
                        <div style={{ color: "#93c5fd", marginTop: "4px" }}>
                          Total Qty: {source.quantity}
                        </div>
                        <div
                          style={{
                            color: "#9ca3af",
                            marginTop: "8px",
                            fontSize: "14px",
                          }}
                        >
                          {source.items.join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {isMobile ? (
        <div style={mobileBottomNavStyle}>
          {canAccess("quoteTool") ? (
            <a href={mobileDashboardHref} style={mobileTabLinkStyle(false)}>
            <span style={mobileTabIconStyle(false)}>D</span>
            <span>Dashboard</span>
          </a>
          ) : null}
          <a href={isEmbeddedRoute ? "/app/custom-quote" : "/custom-quote"} style={mobileTabLinkStyle(true)}>
            <span style={mobileTabIconStyle(true)}>Q</span>
            <span>Quote Tool</span>
          </a>
          {canAccess("reviewQuotes") ? (
            <a href={quoteReviewHref} style={mobileTabLinkStyle(false)}>
            <span style={mobileTabIconStyle(false)}>R</span>
            <span>Review</span>
          </a>
          ) : null}
          {canAccess("dispatch") ? (
            <a href={dispatchHref} style={mobileTabLinkStyle(false)}>
            <span style={mobileTabIconStyle(false)}>X</span>
            <span>Dispatch</span>
          </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
