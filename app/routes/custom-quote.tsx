import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useLocation, useNavigation } from "react-router";
import { data, redirect } from "react-router";
import {
  getRecentCustomQuotes,
  saveCustomQuote,
} from "../lib/custom-quotes.server";
import {
  adminQuoteCookie,
  getAdminQuotePassword,
  hasAdminQuoteAccess,
} from "../lib/admin-quote-auth.server";
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
import { attachAddressAutocomplete, loadGooglePlaces } from "../lib/google-places";
import { getQuote } from "../lib/quote-engine.server";

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
  customer_email?: string | null;
  customer_phone?: string | null;
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

export async function loader({ request }: any) {
  const url = new URL(request.url);

  if (url.searchParams.get("logout") === "1") {
    return redirect("/custom-quote", {
      headers: {
        "Set-Cookie": await adminQuoteCookie.serialize("", { maxAge: 0 }),
      },
    });
  }

  const allowed = await hasAdminQuoteAccess(request);
  const products = allowed ? await getProductOptionsFromSupabase() : [];
  const recentQuotes = allowed ? await getRecentCustomQuotes(15) : [];

  return data({
    allowed,
    products,
    recentQuotes,
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  });
}

export async function action({ request }: any) {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "login") {
    const password = String(form.get("password") || "");
    const expected = getAdminQuotePassword();

    if (!expected || password !== expected) {
      return data(
        {
          allowed: false,
          loginError: "Invalid password",
          products: [],
          recentQuotes: [],
          googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
        },
        { status: 401 },
      );
    }

    const products = await getProductOptionsFromSupabase();
    const recentQuotes = await getRecentCustomQuotes(15);

    return data(
      {
        allowed: true,
        products,
        recentQuotes,
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
      },
      {
        headers: {
          "Set-Cookie": await adminQuoteCookie.serialize("ok"),
        },
      },
    );
  }

  const allowed = await hasAdminQuoteAccess(request);
  if (!allowed) {
    return data(
      {
        allowed: false,
        loginError: "Please log in",
        products: [],
        recentQuotes: [],
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
      },
      { status: 401 },
    );
  }

  const products = await getProductOptionsFromSupabase();
  const recentQuotes = await getRecentCustomQuotes(15);

  const customerName = String(form.get("customerName") || "");
  const customerEmail = String(form.get("customerEmail") || "").trim();
  const customerPhone = String(form.get("customerPhone") || "").trim();
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
  const customTaxRateInput = String(form.get("customTaxRate") || "").trim();
  const customNotes = String(form.get("customNotes") || "").trim();
  const customShippingQuantityInput = String(form.get("customShippingQuantity") || "").trim();
  const customShippingUnit = String(form.get("customShippingUnit") || "miles").trim() === "hours"
    ? "hours"
    : "miles";
  const customShippingRateInput = String(form.get("customShippingRate") || "").trim();
  const customDeliveryAmountValue = Number(customDeliveryAmountInput);
  const customTaxRateValue = Number(customTaxRateInput);
  const customShippingQuantityValue = Number(customShippingQuantityInput);
  const customShippingRateValue = Number(customShippingRateInput);
  const hasCustomShippingCalculation =
    quoteAudience === "custom" &&
    customShippingQuantityInput !== "" &&
    customShippingRateInput !== "" &&
    Number.isFinite(customShippingQuantityValue) &&
    Number.isFinite(customShippingRateValue);
  const rawLines = JSON.parse(String(form.get("linesJson") || "[]"));

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
        customerEmail,
        customerPhone,
        address: { address1, address2, city, province, postalCode, country },
        quoteAudience,
        contractorTier,
        customDeliveryAmount: customDeliveryAmountInput,
        customTaxRate: customTaxRateInput,
        customShippingQuantity: customShippingQuantityInput,
        customShippingUnit,
        customShippingRate: customShippingRateInput,
        customNotes,
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
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
        customerEmail,
        customerPhone,
        address: { address1, address2, city, province, postalCode, country },
        quoteAudience,
        contractorTier,
        customDeliveryAmount: customDeliveryAmountInput,
        customTaxRate: customTaxRateInput,
        customShippingQuantity: customShippingQuantityInput,
        customShippingUnit,
        customShippingRate: customShippingRateInput,
        customNotes,
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
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
  const taxableSubtotal = productsSubtotal + effectiveDeliveryAmount;

  const taxRate =
    quoteAudience === "custom" && customTaxRateInput !== ""
      ? (Number.isFinite(customTaxRateValue)
          ? customTaxRateValue
          : Number(process.env.QUOTE_TAX_RATE || "0"))
      : Number(process.env.QUOTE_TAX_RATE || "0");
  const taxAmount = taxableSubtotal * taxRate;
  const totalAmount = taxableSubtotal + taxAmount;
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

  const sourceBreakdown = getSourceBreakdown(selectedProducts);

  let savedQuoteId: string | null = null;

  if (intent === "save") {
    const saved = await saveCustomQuote({
      shop,
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
      serviceName: effectiveServiceName,
      shippingDetails: shippingCalculationText || undefined,
      description: `${effectiveDescription} Pricing: ${pricingLabel}.`,
      eta: effectiveEta,
      summary: undefined,
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
  }

  return data({
    allowed: true,
    products,
    recentQuotes,
    ok: true,
    customerName,
    customerEmail,
    customerPhone,
    address: { address1, address2, city, province, postalCode, country },
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
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
  const recentQuotes = (actionData?.recentQuotes ??
    loaderData.recentQuotes ??
    []) as SavedQuoteRecord[];
  const googleMapsApiKey =
    actionData?.googleMapsApiKey ?? loaderData.googleMapsApiKey ?? "";
  const embeddedQs = location.search || "";
  const isEmbeddedRoute = location.pathname.startsWith("/app/");
  const createDraftOrderAction = location.pathname.startsWith("/app/")
    ? `/app/api/create-draft-order${embeddedQs}`
    : `/api/create-draft-order${embeddedQs}`;
  const deleteQuoteAction = location.pathname.startsWith("/app/")
    ? `/app/api/delete-quote${embeddedQs}`
    : `/api/delete-quote${embeddedQs}`;
  const quoteReviewHref = isEmbeddedRoute ? "/app/quote-review" : "/quote-review";
  const logoutHref = isEmbeddedRoute ? "/app/custom-quote?logout=1" : "/custom-quote?logout=1";

  const [googleStatus, setGoogleStatus] = useState("Not loaded");
  const [quoteAudience, setQuoteAudience] = useState<QuoteAudience>(
    normalizeQuoteAudience(actionData?.quoteAudience),
  );
  const [contractorTier, setContractorTier] = useState<ContractorTier>(
    normalizeContractorTier(actionData?.contractorTier),
  );
  const [lines, setLines] = useState<QuoteLine[]>([
    { sku: "", quantity: "", search: "", customTitle: "", customPrice: "" },
  ]);
  const [selectedHistoryQuoteId, setSelectedHistoryQuoteId] = useState<string | null>(
    null,
  );
  const deferredLines = useDeferredValue(lines);
  const productSearchIndex = useMemo(
    () =>
      products.map((product: QuoteProductOption) => ({
        product,
        haystack: `${product.title} ${product.sku} ${product.vendor}`.toLowerCase(),
      })),
    [products],
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
    if (deleteQuoteFetcher.data?.ok && deleteQuoteFetcher.data?.deletedQuoteId) {
      setSelectedHistoryQuoteId((current) =>
        current === deleteQuoteFetcher.data.deletedQuoteId ? null : current,
      );
    }
  }, [deleteQuoteFetcher.data]);

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
    ]
      .filter(Boolean)
      .join("\n");
  }, [actionData]);

  const selectedHistoryQuote = useMemo(
    () =>
      recentQuotes.find((quote) => quote.id === selectedHistoryQuoteId) || null,
    [recentQuotes, selectedHistoryQuoteId],
  );

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

  async function copyQuote() {
    if (!quoteText) return;
    await navigator.clipboard.writeText(quoteText);
    alert("Quote copied");
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
              Enter the admin password to access the quote tool.
            </p>

            <Form method="post" autoComplete="off" style={{ marginTop: "22px" }}>
              <input type="hidden" name="intent" value="login" />

              <label style={styles.label}>Admin Password</label>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                style={styles.input}
              />

              {actionData?.loginError ? (
                <div style={styles.statusErr}>{actionData.loginError}</div>
              ) : null}

              <button
                type="submit"
                style={{
                  ...styles.buttonPrimary,
                  marginTop: "18px",
                  width: "100%",
                }}
              >
                Unlock Quote Tool
              </button>
            </Form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
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
            <a href={quoteReviewHref} style={styles.logout}>
              Review Quotes
            </a>
            <a href={logoutHref} style={styles.logout}>
              Log out
            </a>
          </div>
        </div>

        <Form method="post" style={{ display: "grid", gap: "22px" }}>
          <input type="hidden" name="quoteAudience" value={quoteAudience} />
          <input type="hidden" name="contractorTier" value={contractorTier} />
          <input type="hidden" name="linesJson" value={JSON.stringify(lines)} />

          <div style={styles.card}>
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
                  ...(quoteAudience === "custom" ? styles.tabButtonActive : {}),
                }}
              >
                Custom
              </button>
            </div>

            {quoteAudience === "contractor" ? (
              <div style={{ maxWidth: 280 }}>
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
            ) : quoteAudience === "custom" ? (
              <div style={{ color: "#93c5fd", fontSize: 14 }}>
                Custom mode keeps the same quote flow but lets you override line titles,
                unit prices, delivery, shipping math, tax, and notes.
              </div>
            ) : null}
          </div>

          <div style={styles.card}>
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
                  defaultValue={actionData?.customerName || ""}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Email Address</label>
                <input
                  type="email"
                  name="customerEmail"
                  autoComplete="email"
                  defaultValue={actionData?.customerEmail || ""}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Phone Number</label>
                <input
                  type="tel"
                  name="customerPhone"
                  autoComplete="tel"
                  defaultValue={actionData?.customerPhone || ""}
                  style={styles.input}
                />
              </div>

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
                  gridTemplateColumns: "1.3fr 0.8fr 0.8fr 0.8fr",
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

          <div style={styles.card}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "16px",
                marginBottom: "14px",
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
                      padding: "16px",
                      display: "grid",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(360px, 1fr) 160px 120px",
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
                        style={styles.buttonGhost}
                      >
                        Remove
                      </button>
                    </div>

                    {selectedProduct ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
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
                          gridTemplateColumns: "minmax(260px, 1fr) 180px",
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
            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>Custom Adjustments</h2>
              <p style={styles.sectionSub}>
                Override delivery, tax, and the customer-facing quote details before
                calculating or saving.
              </p>

              <div style={{ display: "grid", gap: "14px" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 180px",
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
                    gridTemplateColumns: "160px 160px 180px",
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

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="submit"
              name="intent"
              value="quote"
              style={styles.buttonPrimary}
            >
              {isSubmitting ? "Calculating..." : "Get Full Quote"}
            </button>

            <button
              type="submit"
              name="intent"
              value="save"
              style={styles.buttonSecondary}
            >
              {isSubmitting ? "Saving..." : "Save Quote"}
            </button>
          </div>
        </Form>

        {actionData?.message ? (
          <div style={actionData.ok ? styles.statusOk : styles.statusErr}>
            {actionData.message}
          </div>
        ) : null}

        {actionData?.savedQuoteId ? (
          <div style={styles.statusOk}>
            Quote saved successfully. ID: {actionData.savedQuoteId}
          </div>
        ) : null}

        {actionData?.pricing && actionData?.deliveryQuote ? (
          <div
            style={{
              marginTop: "24px",
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr",
              gap: "20px",
            }}
          >
            <div style={styles.card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <h2 style={{ ...styles.sectionTitle, margin: 0 }}>
                  Full Quote Result
                </h2>
                <button type="button" onClick={copyQuote} style={styles.buttonGhost}>
                  Copy Quote
                </button>
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
                    fontSize: 18,
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

            <div style={styles.card}>
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
          <div style={{ ...styles.card, marginTop: 24 }}>
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
                    padding: 14,
                    background: "rgba(2, 6, 23, 0.72)",
                    color: "#f8fafc",
                    cursor: "pointer",
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
          <div style={{ ...styles.card, marginTop: 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                marginBottom: "16px",
              }}
            >
              <div>
                <h2 style={{ ...styles.sectionTitle, margin: 0 }}>Saved Quote Detail</h2>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
                  {new Date(selectedHistoryQuote.created_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={copyHistoryQuote}
                  style={styles.buttonGhost}
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
                  <button type="submit" style={styles.buttonGhost}>
                    {deleteQuoteFetcher.state === "submitting"
                      ? "Deleting..."
                      : "Delete Quote"}
                  </button>
                </deleteQuoteFetcher.Form>
              </div>
            </div>

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
                  style={styles.buttonGhost}
                >
                  Open Draft Order
                </a>
              ) : null}
              {draftOrderFetcher.data?.draftOrderInvoiceUrl ? (
                <a
                  href={draftOrderFetcher.data.draftOrderInvoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.buttonGhost}
                >
                  Open Invoice
                </a>
              ) : null}
            </draftOrderFetcher.Form>

            {draftOrderFetcher.data?.message ? (
              <div
                style={draftOrderFetcher.data.ok ? styles.statusOk : styles.statusErr}
              >
                {draftOrderFetcher.data.message}
              </div>
            ) : null}

            {deleteQuoteFetcher.data?.message ? (
              <div
                style={deleteQuoteFetcher.data.ok ? styles.statusOk : styles.statusErr}
              >
                {deleteQuoteFetcher.data.message}
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr",
                gap: "20px",
              }}
            >
              <div style={{ display: "grid", gap: "10px", color: "#e5e7eb" }}>
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
                <div>
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

                <div style={{ marginTop: 10 }}>
                  <h3 style={{ margin: "0 0 10px 0", fontSize: 16, color: "#f8fafc" }}>
                    Line Items
                  </h3>
                  <div style={{ display: "grid", gap: 10 }}>
                    {(selectedHistoryQuote.line_items || []).map((line, index) => (
                      <div
                        key={`${line.sku}-${index}`}
                        style={{
                          border: "1px solid #1f2937",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(2, 6, 23, 0.72)",
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
                </div>
              </div>

              <div>
                <h3 style={{ margin: "0 0 10px 0", fontSize: 16, color: "#f8fafc" }}>
                  Source Breakdown
                </h3>
                <div style={{ display: "grid", gap: 12 }}>
                  {(selectedHistoryQuote.source_breakdown || []).map((source, index) => (
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
