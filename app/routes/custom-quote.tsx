import { useEffect, useMemo, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { data, redirect } from "react-router";
import { getQuote } from "../lib/quote-engine.server";
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
import { attachAddressAutocomplete, loadGooglePlaces } from "../lib/google-places";

type QuoteLine = {
  sku: string;
  quantity: string;
  search: string;
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
  const address1 = String(form.get("address1") || "");
  const address2 = String(form.get("address2") || "");
  const city = String(form.get("city") || "");
  const province = String(form.get("province") || "");
  const postalCode = String(form.get("postalCode") || "");
  const country = String(form.get("country") || "US");

  const rawLines = JSON.parse(String(form.get("linesJson") || "[]"));

  const items: Array<{
    sku?: string;
    quantity: number;
    requiresShipping?: boolean;
    pickupVendor?: string;
  }> = [];

  const selectedLines: Array<{
    title: string;
    sku: string;
    vendor: string;
    quantity: number;
  }> = [];

  for (const rawLine of rawLines) {
    const sku = String(rawLine?.sku || "").trim();
    const quantity = Number(rawLine?.quantity || 0);

    if (!sku || quantity <= 0) continue;

    const product = products.find((p) => p.sku === sku);
    if (!product) continue;

    items.push({
      sku: product.sku,
      quantity,
      requiresShipping: true,
      pickupVendor: product.vendor,
    });

    selectedLines.push({
      title: product.title,
      sku: product.sku,
      vendor: product.vendor,
      quantity,
    });
  }

  if (items.length === 0) {
    return data(
      {
        allowed: true,
        products,
        recentQuotes,
        ok: false,
        message:
          "Add at least one product line with a selected product and quantity greater than 0.",
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
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
      },
      { status: 400 },
    );
  }

  const shop = process.env.SHOPIFY_STORE_DOMAIN || "darfaz-2e.myshopify.com";

  const quote = await getQuote({
    shop,
    postalCode,
    country,
    province,
    city,
    address1,
    address2,
    items,
  });

  const sourceBreakdown = getSourceBreakdown(selectedLines);
  let savedQuoteId: string | null = null;

  if (intent === "save") {
    const saved = await saveCustomQuote({
      shop,
      customerName,
      address1,
      address2,
      city,
      province,
      postalCode,
      country,
      quoteTotalCents: quote.cents,
      serviceName: quote.serviceName,
      description: quote.description,
      eta: quote.eta,
      summary: quote.summary,
      sourceBreakdown,
      lineItems: selectedLines,
    });

    savedQuoteId = saved.id;
  }

  return data({
    allowed: true,
    products,
    recentQuotes,
    ok: true,
    quote,
    selectedLines,
    sourceBreakdown,
    savedQuoteId,
    customerName,
    address: { address1, address2, city, province, postalCode, country },
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
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
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const allowed = actionData?.allowed ?? loaderData.allowed;
  const products = actionData?.products ?? loaderData.products ?? [];
  const recentQuotes = actionData?.recentQuotes ?? loaderData.recentQuotes ?? [];
  const googleMapsApiKey =
    actionData?.googleMapsApiKey ?? loaderData.googleMapsApiKey ?? "";

  const [googleStatus, setGoogleStatus] = useState("Not loaded");
  const [lines, setLines] = useState<QuoteLine[]>([
    { sku: "", quantity: "", search: "" },
  ]);

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

  const quoteText = useMemo(() => {
    if (!actionData?.quote) return "";

    const linesText =
      actionData.selectedLines
        ?.map(
          (line: any) =>
            `${line.title} (${line.sku}) x ${line.quantity} — ${line.vendor}`,
        )
        .join("\n") || "";

    return [
      `Service: ${actionData.quote.serviceName}`,
      `Price: $${(actionData.quote.cents / 100).toFixed(2)}`,
      `Description: ${actionData.quote.description}`,
      `ETA: ${actionData.quote.eta}`,
      `Summary: ${actionData.quote.summary}`,
      "",
      linesText,
    ].join("\n");
  }, [actionData]);

  function updateLine(index: number, patch: Partial<QuoteLine>) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, { sku: "", quantity: "", search: "" }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function filteredProducts(index: number) {
    const search = (lines[index]?.search || "").toLowerCase().trim();
    if (!search) return [];

    return products
      .filter((product: QuoteProductOption) => {
        const haystack =
          `${product.title} ${product.sku} ${product.vendor}`.toLowerCase();
        return haystack.includes(search);
      })
      .slice(0, 12);
  }

  async function copyQuote() {
    if (!quoteText) return;
    await navigator.clipboard.writeText(quoteText);
    alert("Quote copied");
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
              Standalone quote portal with product images, customer history, and
              address autocomplete.
            </div>
            <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
              Loaded products: {products.length} · Google Places: {googleStatus}
            </div>
          </div>

          <a href="/custom-quote?logout=1" style={styles.logout}>
            Log out
          </a>
        </div>

        <Form method="post" style={{ display: "grid", gap: "22px" }}>
          <input type="hidden" name="linesJson" value={JSON.stringify(lines)} />

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
                            {selectedProduct.title}
                          </div>
                          <div style={{ fontSize: 13, color: "#bfdbfe" }}>
                            {selectedProduct.sku} — {selectedProduct.vendor}
                          </div>
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

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="submit"
              name="intent"
              value="quote"
              style={styles.buttonPrimary}
            >
              {isSubmitting ? "Calculating..." : "Get Quote"}
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

        {actionData?.quote ? (
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
                <h2 style={{ ...styles.sectionTitle, margin: 0 }}>Quote Result</h2>
                <button type="button" onClick={copyQuote} style={styles.buttonGhost}>
                  Copy Quote
                </button>
              </div>

              <div style={{ display: "grid", gap: "10px", color: "#e5e7eb" }}>
                <div>
                  <strong style={{ color: "#93c5fd" }}>Service:</strong>{" "}
                  {actionData.quote.serviceName}
                </div>
                <div>
                  <strong style={{ color: "#93c5fd" }}>Price:</strong>{" "}
                  ${(actionData.quote.cents / 100).toFixed(2)}
                </div>
                <div>
                  <strong style={{ color: "#93c5fd" }}>Description:</strong>{" "}
                  {actionData.quote.description}
                </div>
                <div>
                  <strong style={{ color: "#93c5fd" }}>ETA:</strong>{" "}
                  {actionData.quote.eta}
                </div>
                <div>
                  <strong style={{ color: "#93c5fd" }}>Summary:</strong>{" "}
                  {actionData.quote.summary}
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
                <div
                  key={quote.id}
                  style={{
                    border: "1px solid #1f2937",
                    borderRadius: 12,
                    padding: 14,
                    background: "rgba(2, 6, 23, 0.72)",
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
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}