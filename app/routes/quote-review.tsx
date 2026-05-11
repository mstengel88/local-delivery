import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useLocation } from "react-router";
import { data, redirect } from "react-router";
import { getRecentCustomQuotes, type SavedCustomQuote } from "../lib/custom-quotes.server";
import {
  adminQuoteCookie,
  getAdminQuotePassword,
  hasAdminQuoteAccess,
} from "../lib/admin-quote-auth.server";

function formatMoney(cents: number | null | undefined) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

const SAVED_QUOTE_FALLBACK_TAX_RATE = 0.055;

function formatDollars(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function parseSavedDeliveryAmount(shippingDetails?: string | null) {
  if (!shippingDetails) return null;

  const exactMatch = shippingDetails.match(/=\s*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const deliveryMatch =
    shippingDetails.match(/delivery(?: fee| amount)?:?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i) ||
    shippingDetails.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  const value = Number(exactMatch?.[1] || deliveryMatch?.[1]);

  return Number.isFinite(value) ? value : null;
}

function getSavedQuotePricingBreakdown(quote: SavedCustomQuote | null) {
  if (!quote) {
    return { productTotal: 0, delivery: 0, tax: 0, total: 0 };
  }

  const productTotal = (quote.line_items || []).reduce(
    (sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 0),
    0,
  );
  const total = Number(quote.quote_total_cents || 0) / 100;
  const parsedDelivery = parseSavedDeliveryAmount(quote.shipping_details);

  if (parsedDelivery !== null) {
    const tax = Math.max(0, total - productTotal - parsedDelivery);
    return { productTotal, delivery: parsedDelivery, tax, total };
  }

  const taxableSubtotal = total / (1 + SAVED_QUOTE_FALLBACK_TAX_RATE);
  const delivery = Math.max(0, taxableSubtotal - productTotal);
  const tax = Math.max(0, total - taxableSubtotal);

  return { productTotal, delivery, tax, total };
}

function buildQuoteSearchText(quote: SavedCustomQuote) {
  const lineText = (quote.line_items || [])
    .map((line) =>
      [
        line.title,
        line.sku,
        line.vendor,
        line.pricingLabel,
        line.audience,
        line.contractorTier,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");

  const sourceText = Array.isArray(quote.source_breakdown)
    ? quote.source_breakdown
        .map((entry: any) =>
          [entry?.vendor, ...(Array.isArray(entry?.items) ? entry.items : [])]
            .filter(Boolean)
            .join(" "),
        )
        .join(" ")
    : "";

  return [
    quote.id,
    quote.customer_name,
    quote.customer_email,
    quote.customer_phone,
    quote.address1,
    quote.address2,
    quote.city,
    quote.province,
    quote.postal_code,
    quote.country,
    quote.service_name,
    quote.shipping_details,
    quote.description,
    quote.summary,
    quote.eta,
    lineText,
    sourceText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, rgba(30, 64, 175, 0.24), transparent 35%), linear-gradient(180deg, #020617 0%, #0f172a 55%, #111827 100%)",
    color: "#f8fafc",
    padding: "32px 20px 56px",
    fontFamily:
      '"Avenir Next", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif',
  } as const,
  shell: {
    maxWidth: "1200px",
    margin: "0 auto",
    display: "grid",
    gap: "20px",
  } as const,
  card: {
    background: "rgba(15, 23, 42, 0.88)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: "24px",
    padding: "24px",
    boxShadow: "0 22px 48px rgba(2, 6, 23, 0.34)",
    backdropFilter: "blur(10px)",
  } as const,
  title: {
    margin: 0,
    fontSize: "clamp(2rem, 4vw, 3rem)",
    fontWeight: 800,
    letterSpacing: "-0.04em",
  } as const,
  subtitle: {
    margin: "10px 0 0",
    color: "#94a3b8",
    lineHeight: 1.6,
  } as const,
  label: {
    display: "block",
    marginBottom: "8px",
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "#cbd5e1",
  } as const,
  input: {
    width: "100%",
    borderRadius: "14px",
    border: "1px solid #334155",
    background: "rgba(15, 23, 42, 0.92)",
    color: "#f8fafc",
    padding: "14px 16px",
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  buttonPrimary: {
    border: "none",
    borderRadius: "14px",
    padding: "12px 18px",
    background: "linear-gradient(135deg, #2563eb, #14b8a6)",
    color: "#eff6ff",
    fontWeight: 800,
    cursor: "pointer",
  } as const,
  buttonGhost: {
    border: "1px solid rgba(148, 163, 184, 0.28)",
    borderRadius: "14px",
    padding: "12px 18px",
    background: "rgba(15, 23, 42, 0.62)",
    color: "#e2e8f0",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  } as const,
  statusOk: {
    marginTop: "16px",
    padding: "14px 16px",
    borderRadius: "14px",
    background: "rgba(22, 163, 74, 0.15)",
    border: "1px solid rgba(34, 197, 94, 0.5)",
    color: "#dcfce7",
  } as const,
  statusErr: {
    marginTop: "16px",
    padding: "14px 16px",
    borderRadius: "14px",
    background: "rgba(220, 38, 38, 0.15)",
    border: "1px solid rgba(248, 113, 113, 0.5)",
    color: "#fee2e2",
  } as const,
};

export async function loader({ request }: any) {
  const url = new URL(request.url);
  const isEmbeddedRoute = url.pathname.startsWith("/app/");
  const reviewPath = isEmbeddedRoute ? "/app/quote-review" : "/quote-review";

  if (url.searchParams.get("logout") === "1") {
    return redirect(reviewPath, {
      headers: {
        "Set-Cookie": await adminQuoteCookie.serialize("", { maxAge: 0 }),
      },
    });
  }

  const allowed = await hasAdminQuoteAccess(request);
  const quotes = allowed ? await getRecentCustomQuotes(250) : [];

  return data({ allowed, quotes });
}

export async function action({ request }: any) {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent !== "login") {
    return data({ allowed: false, loginError: "Invalid request", quotes: [] }, { status: 400 });
  }

  const password = String(form.get("password") || "");
  const expected = getAdminQuotePassword();

  if (!expected || password !== expected) {
    return data(
      { allowed: false, loginError: "Invalid password", quotes: [] },
      { status: 401 },
    );
  }

  return data(
    {
      allowed: true,
      loginError: null,
      quotes: await getRecentCustomQuotes(250),
    },
    {
      headers: {
        "Set-Cookie": await adminQuoteCookie.serialize("ok"),
      },
    },
  );
}

export default function QuoteReviewPage() {
  const loaderData = useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>() as any;
  const location = useLocation();
  const draftOrderFetcher = useFetcher<any>();
  const deleteQuoteFetcher = useFetcher<any>();
  const isEmbeddedRoute = location.pathname.startsWith("/app/");

  const allowed = actionData?.allowed ?? loaderData.allowed;
  const quotes = ((actionData?.quotes || loaderData.quotes) || []) as SavedCustomQuote[];
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(quotes[0]?.id || null);

  const createDraftOrderAction = isEmbeddedRoute
    ? `/app/api/create-draft-order${location.search || ""}`
    : `/api/create-draft-order${location.search || ""}`;
  const deleteQuoteAction = isEmbeddedRoute
    ? `/app/api/delete-quote${location.search || ""}`
    : `/api/delete-quote${location.search || ""}`;
  const quoteToolHref = isEmbeddedRoute ? "/app/custom-quote" : "/custom-quote";

  const indexedQuotes = useMemo(
    () =>
      quotes.map((quote) => ({
        quote,
        haystack: buildQuoteSearchText(quote),
      })),
    [quotes],
  );

  const filteredQuotes = useMemo(() => {
    const trimmed = deferredQuery.trim().toLowerCase();
    if (!trimmed) return indexedQuotes.map((entry) => entry.quote);
    return indexedQuotes
      .filter((entry) => entry.haystack.includes(trimmed))
      .map((entry) => entry.quote);
  }, [deferredQuery, indexedQuotes]);

  const selectedQuote =
    filteredQuotes.find((quote) => quote.id === selectedQuoteId) ||
    filteredQuotes[0] ||
    null;
  const selectedQuotePricing = useMemo(
    () => getSavedQuotePricingBreakdown(selectedQuote),
    [selectedQuote],
  );

  useEffect(() => {
    if (deleteQuoteFetcher.data?.ok && deleteQuoteFetcher.data?.deletedQuoteId) {
      setSelectedQuoteId((current) =>
        current === deleteQuoteFetcher.data.deletedQuoteId ? null : current,
      );
    }
  }, [deleteQuoteFetcher.data]);

  if (!allowed) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.shell, maxWidth: 520 }}>
          <div style={styles.card}>
            <h1 style={styles.title}>Quote Review</h1>
            <p style={styles.subtitle}>
              Enter the admin password to search saved quotes and send them to Shopify.
            </p>

            <Form method="post" autoComplete="off" style={{ marginTop: 22 }}>
              <input type="hidden" name="intent" value="login" />
              <label style={styles.label}>Admin Password</label>
              <input type="password" name="password" autoComplete="current-password" style={styles.input} />
              {actionData?.loginError ? (
                <div style={styles.statusErr}>{actionData.loginError}</div>
              ) : null}
              <button type="submit" style={{ ...styles.buttonPrimary, marginTop: 16 }}>
                Open Quote Review
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
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h1 style={styles.title}>Quote Review</h1>
              <p style={styles.subtitle}>
                Search across customer info, address, notes, SKU, product titles, vendors, and saved quote details.
              </p>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <a href={quoteToolHref} style={styles.buttonGhost}>Open Quote Tool</a>
              <a href="?logout=1" style={styles.buttonGhost}>Log Out</a>
            </div>
          </div>
        </div>

        <div style={{ ...styles.card, display: "grid", gap: 14 }}>
          <div>
            <label style={styles.label}>Search Saved Quotes</label>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by customer, email, city, ZIP, summary, SKU, vendor, quote ID..."
              style={styles.input}
            />
          </div>
          <div style={{ color: "#94a3b8", fontSize: 14 }}>
            Showing {filteredQuotes.length} of {quotes.length} saved quotes
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div style={{ ...styles.card, maxHeight: "70vh", overflowY: "auto" }}>
            <div style={{ display: "grid", gap: 12 }}>
              {filteredQuotes.length === 0 ? (
                <div style={{ color: "#94a3b8" }}>No saved quotes matched your search.</div>
              ) : (
                filteredQuotes.map((quote) => (
                  <button
                    key={quote.id}
                    type="button"
                    onClick={() => setSelectedQuoteId(quote.id)}
                    style={{
                      textAlign: "left",
                      padding: 16,
                      borderRadius: 16,
                      border:
                        selectedQuote?.id === quote.id
                          ? "1px solid rgba(45, 212, 191, 0.6)"
                          : "1px solid rgba(51, 65, 85, 0.9)",
                      background:
                        selectedQuote?.id === quote.id
                          ? "rgba(20, 184, 166, 0.14)"
                          : "rgba(2, 6, 23, 0.7)",
                      color: "#f8fafc",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      {quote.customer_name || quote.customer_email || "Unnamed quote"}
                    </div>
                    <div style={{ marginTop: 6, color: "#bfdbfe", fontSize: 13 }}>
                      {quote.customer_email || "No email"}
                    </div>
                    <div style={{ marginTop: 4, color: "#cbd5e1", fontSize: 13 }}>
                      {quote.customer_phone || "No phone"}
                    </div>
                    <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 13 }}>
                      {quote.address1}, {quote.city}, {quote.province} {quote.postal_code}
                    </div>
                    <div
                      style={{
                        marginTop: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        fontSize: 13,
                        color: "#cbd5e1",
                      }}
                    >
                      <span>{formatMoney(quote.quote_total_cents)}</span>
                      <span>{new Date(quote.created_at).toLocaleString()}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div style={styles.card}>
            {selectedQuote ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 24 }}>Saved Quote Detail</h2>
                    <div style={{ color: "#94a3b8", marginTop: 6, fontSize: 14 }}>
                      Quote ID: {selectedQuote.id}
                    </div>
                    <div style={{ color: "#94a3b8", marginTop: 4, fontSize: 14 }}>
                      {new Date(selectedQuote.created_at).toLocaleString()}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <draftOrderFetcher.Form
                      method="post"
                      action={createDraftOrderAction}
                      style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
                    >
                      <input type="hidden" name="quoteId" value={selectedQuote.id} />
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

                    <deleteQuoteFetcher.Form
                      method="post"
                      action={deleteQuoteAction}
                      onSubmit={(event) => {
                        if (!window.confirm("Delete this quote? This can't be undone.")) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="quoteId" value={selectedQuote.id} />
                      <button type="submit" style={styles.buttonGhost}>
                        {deleteQuoteFetcher.state === "submitting"
                          ? "Deleting..."
                          : "Delete Quote"}
                      </button>
                    </deleteQuoteFetcher.Form>
                  </div>
                </div>

                {draftOrderFetcher.data?.message ? (
                  <div style={draftOrderFetcher.data.ok ? styles.statusOk : styles.statusErr}>
                    {draftOrderFetcher.data.message}
                  </div>
                ) : null}

                {deleteQuoteFetcher.data?.message ? (
                  <div style={deleteQuoteFetcher.data.ok ? styles.statusOk : styles.statusErr}>
                    {deleteQuoteFetcher.data.message}
                  </div>
                ) : null}

                <div
                  style={{
                    marginTop: 20,
                    display: "grid",
                    gridTemplateColumns: "1.1fr 1fr",
                    gap: 20,
                  }}
                >
                  <div style={{ display: "grid", gap: 10 }}>
                    <div><strong>Customer:</strong> {selectedQuote.customer_name || "Unnamed customer"}</div>
                    <div><strong>Email:</strong> {selectedQuote.customer_email || "N/A"}</div>
                    <div><strong>Phone:</strong> {selectedQuote.customer_phone || "N/A"}</div>
                    <div>
                      <strong>Address:</strong> {selectedQuote.address1}, {selectedQuote.city},{" "}
                      {selectedQuote.province} {selectedQuote.postal_code}
                    </div>
                    <div><strong>Country:</strong> {selectedQuote.country || "US"}</div>
                    <div><strong>Product Total:</strong> {formatDollars(selectedQuotePricing.productTotal)}</div>
                    <div><strong>Delivery:</strong> {formatDollars(selectedQuotePricing.delivery)}</div>
                    <div><strong>Tax:</strong> {formatDollars(selectedQuotePricing.tax)}</div>
                    <div><strong>Total:</strong> {formatDollars(selectedQuotePricing.total)}</div>
                    <div><strong>Service:</strong> {selectedQuote.service_name || "Quote"}</div>
                    {selectedQuote.shipping_details ? (
                      <div><strong>Shipping Details:</strong> {selectedQuote.shipping_details}</div>
                    ) : null}
                    <div><strong>Notes:</strong> {selectedQuote.description || "N/A"}</div>
                  </div>

                  <div style={{ display: "grid", gap: 12 }}>
                    <h3 style={{ margin: 0 }}>Line Items</h3>
                    {(selectedQuote.line_items || []).length === 0 ? (
                      <div style={{ color: "#94a3b8" }}>No saved line items.</div>
                    ) : (
                      (selectedQuote.line_items || []).map((line, index) => (
                        <div
                          key={`${line.sku}-${index}`}
                          style={{
                            border: "1px solid #1f2937",
                            borderRadius: 14,
                            padding: 14,
                            background: "rgba(2, 6, 23, 0.72)",
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>{line.title}</div>
                          <div style={{ color: "#94a3b8", marginTop: 4, fontSize: 14 }}>
                            {line.sku} {line.vendor ? `- ${line.vendor}` : ""}
                          </div>
                          <div style={{ color: "#cbd5e1", marginTop: 8, fontSize: 14 }}>
                            Qty {line.quantity} at ${Number(line.price || 0).toFixed(2)}
                            {line.pricingLabel ? ` - ${line.pricingLabel}` : ""}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: "#94a3b8" }}>Select a saved quote to review it.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
