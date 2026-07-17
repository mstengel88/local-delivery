import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useLocation } from "react-router";
import { data, redirect } from "react-router";
import { getRecentCustomQuotes, type SavedCustomQuote } from "../lib/custom-quotes.server";
import {
  adminQuoteCookie,
  hasAdminQuotePermissionAccess,
} from "../lib/admin-quote-auth.server";
import { getCurrentUser, userAuthCookie } from "../lib/user-auth.server";

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

  const tax = Math.max(0, productTotal * SAVED_QUOTE_FALLBACK_TAX_RATE);
  const delivery = Math.max(0, total - productTotal - tax);

  return { productTotal, delivery, tax, total };
}

function escapePrintHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getSavedQuoteNumber(quote: SavedCustomQuote) {
  return quote.id;
}

function shouldPrintEta(eta?: string | null) {
  const normalized = String(eta || "")
    .trim()
    .replace(/[–—]/g, "-")
    .toLowerCase();

  return Boolean(normalized && !/^2\s*-\s*4\s+business\s+days$/.test(normalized));
}

function buildSavedQuotePrintHtml(
  quote: SavedCustomQuote,
  pricing: ReturnType<typeof getSavedQuotePricingBreakdown>,
  logoUrl: string,
) {
  const quoteDate = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(quote.created_at));
  const companyContactLines = [
    "W185N7487 Narrow Lane",
    "Menomonee Falls, WI 53051",
    "(262) 345-4001",
    "info@greenhillssupply.com",
  ];
  const customerLines = [
    quote.customer_name,
    quote.customer_email,
    quote.customer_phone,
  ].filter(Boolean);
  const addressLines = [
    quote.address1,
    quote.address2,
    [quote.city, quote.province, quote.postal_code].filter(Boolean).join(", "),
    quote.country || "US",
  ].filter(Boolean);
  const lineRows =
    (quote.line_items || [])
      .map((line) => {
        const quantity = Number(line.quantity || 0);
        const lineTotal = Number(line.price || 0) * quantity;

        return `
          <tr>
            <td>
              <strong>${escapePrintHtml(line.title)}</strong>
              <span>${escapePrintHtml(line.sku || "")}${line.vendor ? ` · ${escapePrintHtml(line.vendor)}` : ""}</span>
            </td>
            <td>${escapePrintHtml(quantity)}</td>
            <td>${escapePrintHtml(formatDollars(Number(line.price || 0)))}</td>
            <td>${escapePrintHtml(formatDollars(lineTotal))}</td>
          </tr>`;
      })
      .join("") ||
    `<tr><td colspan="4" class="empty">No saved line items.</td></tr>`;
  const etaLine = shouldPrintEta(quote.eta)
    ? `<div>${escapePrintHtml(quote.eta)}</div>`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Green Hills Supply Quote ${escapePrintHtml(getSavedQuoteNumber(quote))}</title>
  <style>
    @page { margin: 0.45in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172033; font-family: Arial, Helvetica, sans-serif; background: #fff; }
    .quote { max-width: 850px; margin: 0 auto; border: 2px solid #111827; border-radius: 18px; overflow: hidden; }
    .header { display: flex; align-items: center; gap: 26px; padding: 24px 30px; border-bottom: 6px solid #8fd400; background: linear-gradient(135deg, #f7fbef 0%, #ffffff 72%); }
    .brand { width: 210px; text-align: center; }
    .logo { width: 180px; max-height: 110px; object-fit: contain; }
    .company-contact { margin-top: 8px; color: #334155; font-size: 12px; font-weight: 700; line-height: 1.35; }
    .title { flex: 1; text-align: right; }
    h1 { margin: 0; font-size: 34px; line-height: 1; letter-spacing: -0.03em; }
    .quote-number { margin-top: 8px; color: #0f766e; font-size: 16px; font-weight: 900; }
    .date { margin-top: 7px; color: #475569; font-size: 14px; font-weight: 700; }
    .section { padding: 24px 30px; border-bottom: 1px solid #d8dee8; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .label { color: #0f766e; font-size: 12px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
    .box { min-height: 112px; border: 1px solid #cbd5e1; border-radius: 14px; padding: 14px 16px; line-height: 1.45; font-size: 15px; }
    .box strong { display: block; font-size: 17px; margin-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #111827; color: #fff; padding: 11px 12px; text-align: left; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
    td { border-bottom: 1px solid #d8dee8; padding: 13px 12px; vertical-align: top; font-size: 14px; }
    td span { display: block; color: #64748b; margin-top: 4px; font-size: 12px; }
    th:nth-child(2), th:nth-child(3), th:nth-child(4), td:nth-child(2), td:nth-child(3), td:nth-child(4) { text-align: right; white-space: nowrap; }
    .empty { text-align: center !important; color: #64748b; }
    .totals { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 24px; align-items: start; }
    .total-table td { border: 0; padding: 8px 0; }
    .total-table td:first-child { color: #475569; font-weight: 700; }
    .total-table td:last-child { text-align: right; font-weight: 800; }
    .grand td { border-top: 2px solid #111827; padding-top: 13px; font-size: 22px; color: #111827; }
    .note { padding: 18px 30px 26px; color: #334155; font-size: 15px; line-height: 1.45; background: #f8fafc; }
    .footer { padding: 14px 30px 22px; color: #64748b; font-size: 12px; text-align: center; }
    @media print { .quote { border-radius: 0; } }
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
        <div class="quote-number">Quote #${escapePrintHtml(getSavedQuoteNumber(quote))}</div>
        <div class="date">${escapePrintHtml(quoteDate)}</div>
      </div>
    </header>
    <section class="section grid">
      <div><div class="label">Customer</div><div class="box">${customerLines.map((line) => `<div>${escapePrintHtml(line)}</div>`).join("") || "<div>Customer information not provided</div>"}</div></div>
      <div><div class="label">Delivery Address</div><div class="box">${addressLines.map((line) => `<div>${escapePrintHtml(line)}</div>`).join("") || "<div>Address not provided</div>"}</div></div>
    </section>
    <section class="section">
      <div class="label">Products</div>
      <table><thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>${lineRows}</tbody></table>
    </section>
    <section class="section totals">
      <div>
        <div class="label">Delivery Details</div>
        <div class="box">
          <strong>${escapePrintHtml(quote.service_name || "Delivery")}</strong>
          ${etaLine}
          <div>${escapePrintHtml(quote.description || "Standard delivery pricing")}</div>
        </div>
      </div>
      <table class="total-table"><tbody>
        <tr><td>Product Total</td><td>${escapePrintHtml(formatDollars(pricing.productTotal))}</td></tr>
        <tr><td>Delivery</td><td>${escapePrintHtml(formatDollars(pricing.delivery))}</td></tr>
        <tr><td>Tax</td><td>${escapePrintHtml(formatDollars(pricing.tax))}</td></tr>
        <tr class="grand"><td>Total</td><td>${escapePrintHtml(formatDollars(pricing.total))}</td></tr>
      </tbody></table>
    </section>
    <div class="note">Please let us know if you have any questions or would like to proceed with your order.</div>
    <div class="footer">Green Hills Supply</div>
  </main>
</body>
</html>`;
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
    quote.created_by_name,
    quote.created_by_email,
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
      headers: [
        ["Set-Cookie", await userAuthCookie.serialize("", { maxAge: 0 })],
        ["Set-Cookie", await adminQuoteCookie.serialize("", { maxAge: 0 })],
      ],
    });
  }

  const allowed = await hasAdminQuotePermissionAccess(request, "reviewQuotes");
  if (!allowed) {
    return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const [quotes, currentUser] = allowed
    ? await Promise.all([getRecentCustomQuotes(250), getCurrentUser(request)])
    : [[], null];

  return data({ allowed, currentUser, quotes });
}

export async function action({ request }: any) {
  const url = new URL(request.url);
  const allowed = await hasAdminQuotePermissionAccess(request, "reviewQuotes");
  if (!allowed) {
    return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  return data({ allowed: true, quotes: await getRecentCustomQuotes(250) });
}

export default function QuoteReviewPage() {
  const loaderData = useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>() as any;
  const location = useLocation();
  const draftOrderFetcher = useFetcher<any>();
  const deleteQuoteFetcher = useFetcher<any>();
  const updateQuoteFetcher = useFetcher<any>();
  const isEmbeddedRoute = location.pathname.startsWith("/app/");
  const urlParams = new URLSearchParams(location.search);
  const requestedQuoteId = urlParams.get("quote");

  const allowed = actionData?.allowed ?? loaderData.allowed;
  const currentUser = actionData?.currentUser ?? loaderData.currentUser ?? null;
  const rawQuotes = ((actionData?.quotes || loaderData.quotes) || []) as SavedCustomQuote[];
  const [editedQuotesById, setEditedQuotesById] = useState<Record<string, SavedCustomQuote>>({});
  const quotes = rawQuotes.map((quote) => editedQuotesById[quote.id] || quote);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(
    requestedQuoteId || quotes[0]?.id || null,
  );
  const [isMobile, setIsMobile] = useState(false);
  const [detailSectionsOpen, setDetailSectionsOpen] = useState({
    customer: true,
    lineItems: false,
  });

  const createDraftOrderAction = isEmbeddedRoute
    ? `/app/api/create-draft-order${location.search || ""}`
    : `/api/create-draft-order${location.search || ""}`;
  const deleteQuoteAction = isEmbeddedRoute
    ? `/app/api/delete-quote${location.search || ""}`
    : `/api/delete-quote${location.search || ""}`;
  const updateQuoteAction = isEmbeddedRoute
    ? `/app/api/update-quote${location.search || ""}`
    : `/api/update-quote${location.search || ""}`;
  const quoteToolHref = isEmbeddedRoute ? "/app/custom-quote" : "/custom-quote";
  const dispatchHref = "/";
  const mobileDashboardHref = "/driver";
  const logoutHref = currentUser ? "/login?logout=1" : "?logout=1";
  const loginHref = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  const canAccess = (permission: string) =>
    !currentUser || currentUser.permissions?.includes(permission);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);

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
  const mobileActionButtonStyle = {
    ...styles.buttonGhost,
    minHeight: isMobile ? 48 : undefined,
    width: isMobile ? "100%" : undefined,
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

  function toggleDetailSection(key: keyof typeof detailSectionsOpen) {
    setDetailSectionsOpen((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function printSavedQuote() {
    if (!selectedQuote) return;

    const popup = window.open("", "green-hills-saved-quote-print", "width=900,height=1100");

    if (!popup) {
      alert("Please allow popups to print the quote.");
      return;
    }

    popup.document.write(
      buildSavedQuotePrintHtml(
        selectedQuote,
        selectedQuotePricing,
        `${window.location.origin}/email-green-hills-logo.png`,
      ),
    );
    popup.document.close();

    popup.addEventListener("load", () => {
      popup.focus();
      popup.print();
    });
  }

  useEffect(() => {
    if (deleteQuoteFetcher.data?.ok && deleteQuoteFetcher.data?.deletedQuoteId) {
      setSelectedQuoteId((current) =>
        current === deleteQuoteFetcher.data.deletedQuoteId ? null : current,
      );
    }
  }, [deleteQuoteFetcher.data]);

  useEffect(() => {
    if (updateQuoteFetcher.data?.ok && updateQuoteFetcher.data?.quote) {
      const quote = updateQuoteFetcher.data.quote as SavedCustomQuote;
      setEditedQuotesById((current) => ({
        ...current,
        [quote.id]: quote,
      }));
      setSelectedQuoteId(quote.id);
      setEditingQuoteId(null);
    }
  }, [updateQuoteFetcher.data]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(max-width: 900px)");
    const updateViewport = () => setIsMobile(media.matches);

    updateViewport();
    media.addEventListener("change", updateViewport);

    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (requestedQuoteId) {
      setSelectedQuoteId(requestedQuoteId);
    }
  }, [requestedQuoteId]);

  if (!allowed) {
    return (
      <div style={{ ...styles.page, padding: isMobile ? "20px 14px 40px" : styles.page.padding }}>
        <div style={{ ...styles.shell, maxWidth: 520 }}>
          <div style={styles.card}>
            <h1 style={styles.title}>Quote Review</h1>
            <p style={styles.subtitle}>
              Sign in with your contractor user account to search saved quotes and send them to Shopify.
            </p>
            <a
              href={loginHref}
              style={{
                ...styles.buttonPrimary,
                marginTop: 16,
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
            <h1 style={{ ...styles.title, fontSize: "2.2rem" }}>Quote Review</h1>
            <p style={styles.subtitle}>
              Search across customer info, address, notes, SKU, product titles, vendors, and saved quote details.
            </p>
          </div>
        ) : (
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <h1 style={styles.title}>Quote Review</h1>
                <p style={styles.subtitle}>
                  Search across customer info, address, notes, SKU, product titles, vendors, and saved quote details.
                </p>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {canAccess("quoteTool") ? (
                  <a href={mobileDashboardHref} style={styles.buttonGhost}>Dashboard</a>
                ) : null}
                {canAccess("quoteTool") ? (
                  <a href={quoteToolHref} style={styles.buttonGhost}>Open Quote Tool</a>
                ) : null}
                {canAccess("dispatch") ? (
                  <a href={dispatchHref} style={styles.buttonGhost}>Dispatch</a>
                ) : null}
                {canAccess("manageUsers") ? (
                  <a href="/settings" style={styles.buttonGhost}>Settings</a>
                ) : null}
                {currentUser ? (
                  <a href="/change-password" style={styles.buttonGhost}>Change Password</a>
                ) : null}
                <a href={logoutHref} style={styles.buttonGhost}>Log Out</a>
              </div>
            </div>
          </div>
        )}

        <div style={{ ...styles.card, display: "grid", gap: 14, padding: isMobile ? "18px" : styles.card.padding }}>
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
            gridTemplateColumns: isMobile
              ? "minmax(0, 1fr)"
              : "minmax(320px, 420px) minmax(0, 1fr)",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div
            style={{
              ...styles.card,
              maxHeight: isMobile ? "none" : "70vh",
              overflowY: isMobile ? "visible" : "auto",
              padding: isMobile ? "18px" : styles.card.padding,
            }}
          >
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
                      padding: isMobile ? 16 : 14,
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
                      overflowWrap: "anywhere",
                      minHeight: isMobile ? 92 : undefined,
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

          <div style={{ ...styles.card, padding: isMobile ? "18px" : styles.card.padding }}>
            {selectedQuote ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: isMobile ? "flex-start" : "center" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 24 }}>Saved Quote Detail</h2>
                    <div style={{ color: "#94a3b8", marginTop: 6, fontSize: 14 }}>
                      Quote ID: {selectedQuote.id}
                    </div>
                    <div style={{ color: "#94a3b8", marginTop: 4, fontSize: 14 }}>
                      {new Date(selectedQuote.created_at).toLocaleString()}
                    </div>
                    <div style={{ color: "#93c5fd", marginTop: 4, fontSize: 14 }}>
                      Created by{" "}
                      {selectedQuote.created_by_name ||
                        selectedQuote.created_by_email ||
                        "Unknown user"}
                    </div>
                  </div>

                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", width: isMobile ? "100%" : undefined }}>
                      {canAccess("sendToShopify") ? (
                      <draftOrderFetcher.Form
                        method="post"
                        action={createDraftOrderAction}
                        style={{ display: "flex", gap: 12, flexWrap: "wrap", width: isMobile ? "100%" : undefined }}
                      >
                        <input type="hidden" name="quoteId" value={selectedQuote.id} />
                      <button type="submit" style={{ ...styles.buttonPrimary, width: isMobile ? "100%" : undefined }}>
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

                    <button
                      type="button"
                      onClick={() =>
                        setEditingQuoteId((current) =>
                          current === selectedQuote.id ? null : selectedQuote.id,
                        )
                      }
                      style={mobileActionButtonStyle}
                    >
                      {editingQuoteId === selectedQuote.id ? "Cancel Regenerate" : "Edit / Regenerate"}
                    </button>

                    <button
                      type="button"
                      onClick={printSavedQuote}
                      style={mobileActionButtonStyle}
                    >
                      Print Quote
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
                      <input type="hidden" name="quoteId" value={selectedQuote.id} />
                      <button type="submit" style={mobileActionButtonStyle}>
                        {deleteQuoteFetcher.state === "submitting"
                          ? "Deleting..."
                          : "Delete Quote"}
                      </button>
                    </deleteQuoteFetcher.Form>
                  </div>
                </div>

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

                {updateQuoteFetcher.data?.message ? (
                  <div
                    style={{
                      ...(updateQuoteFetcher.data.ok ? styles.statusOk : styles.statusErr),
                      fontSize: isMobile ? 16 : undefined,
                      fontWeight: isMobile ? 700 : undefined,
                    }}
                  >
                    {updateQuoteFetcher.data.message}
                  </div>
                ) : null}

                {editingQuoteId === selectedQuote.id ? (
                  <updateQuoteFetcher.Form
                    method="post"
                    action={updateQuoteAction}
                    style={{
                      marginTop: 20,
                      display: "grid",
                      gap: 16,
                      padding: 16,
                      borderRadius: 18,
                      border: "1px solid rgba(45, 212, 191, 0.35)",
                      background: "rgba(20, 184, 166, 0.08)",
                    }}
                  >
                    <input type="hidden" name="quoteId" value={selectedQuote.id} />
                    <h3 style={{ margin: 0 }}>Edit And Regenerate Quote</h3>
                    <div style={{ color: "#93c5fd", fontSize: 13, lineHeight: 1.5 }}>
                      Updating quantities or address will recalculate delivery, truck-load logic,
                      tax, and the saved total.
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "minmax(0, 1fr)"
                          : "repeat(3, minmax(0, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div>
                        <label style={styles.label}>Customer Name</label>
                        <input name="customerName" defaultValue={selectedQuote.customer_name || ""} style={styles.input} />
                      </div>
                      <div>
                        <label style={styles.label}>Email</label>
                        <input name="customerEmail" defaultValue={selectedQuote.customer_email || ""} style={styles.input} />
                      </div>
                      <div>
                        <label style={styles.label}>Phone</label>
                        <input name="customerPhone" defaultValue={selectedQuote.customer_phone || ""} style={styles.input} />
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "minmax(0, 1fr)"
                          : "1.4fr 0.9fr 0.5fr 0.5fr 0.5fr",
                        gap: 12,
                      }}
                    >
                      <div>
                        <label style={styles.label}>Address 1</label>
                        <input name="address1" defaultValue={selectedQuote.address1 || ""} style={styles.input} />
                      </div>
                      <div>
                        <label style={styles.label}>City</label>
                        <input name="city" defaultValue={selectedQuote.city || ""} style={styles.input} />
                      </div>
                      <div>
                        <label style={styles.label}>State</label>
                        <input name="province" defaultValue={selectedQuote.province || ""} style={styles.input} />
                      </div>
                      <div>
                        <label style={styles.label}>ZIP</label>
                        <input name="postalCode" defaultValue={selectedQuote.postal_code || ""} style={styles.input} />
                      </div>
                      <div>
                        <label style={styles.label}>Country</label>
                        <input name="country" defaultValue={selectedQuote.country || "US"} style={styles.input} />
                      </div>
                    </div>

                    <div>
                      <label style={styles.label}>Address 2</label>
                      <input name="address2" defaultValue={selectedQuote.address2 || ""} style={styles.input} />
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <h4 style={{ margin: 0 }}>Line Quantities</h4>
                      {(selectedQuote.line_items || []).map((line, index) => (
                        <div
                          key={`${line.sku}-${index}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) 130px",
                            gap: 12,
                            alignItems: "end",
                            padding: 12,
                            borderRadius: 14,
                            border: "1px solid rgba(51, 65, 85, 0.9)",
                            background: "rgba(2, 6, 23, 0.42)",
                          }}
                        >
                          <div style={{ overflowWrap: "anywhere" }}>
                            <div style={{ fontWeight: 800 }}>{line.title}</div>
                            <div style={{ color: "#94a3b8", marginTop: 4, fontSize: 13 }}>
                              {line.sku} · Unit ${Number(line.price || 0).toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <label style={styles.label}>Quantity</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              name={`lineQuantity::${index}`}
                              defaultValue={line.quantity}
                              style={styles.input}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <button type="submit" style={styles.buttonPrimary}>
                        {updateQuoteFetcher.state === "submitting"
                          ? "Regenerating..."
                          : "Regenerate Quote"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingQuoteId(null)}
                        style={styles.buttonGhost}
                      >
                        Cancel
                      </button>
                    </div>
                  </updateQuoteFetcher.Form>
                ) : null}

                <div
                  style={{
                    marginTop: 20,
                    display: "grid",
                    gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "1.1fr 1fr",
                    gap: 20,
                  }}
                >
                  <div style={{ display: "grid", gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => toggleDetailSection("customer")}
                      style={mobileActionButtonStyle}
                    >
                      {detailSectionsOpen.customer ? "Hide Quote Info" : "Show Quote Info"}
                    </button>
                    {detailSectionsOpen.customer ? (
                      <div style={{ display: "grid", gap: 10, overflowWrap: "anywhere" }}>
                        <div><strong>Customer:</strong> {selectedQuote.customer_name || "Unnamed customer"}</div>
                        <div><strong>Email:</strong> {selectedQuote.customer_email || "N/A"}</div>
                        <div><strong>Phone:</strong> {selectedQuote.customer_phone || "N/A"}</div>
                        <div>
                          <strong>Address:</strong> {selectedQuote.address1}, {selectedQuote.city},{" "}
                          {selectedQuote.province} {selectedQuote.postal_code}
                        </div>
                        <div><strong>Country:</strong> {selectedQuote.country || "US"}</div>
                        <div>
                          <strong>Created By:</strong>{" "}
                          {selectedQuote.created_by_name ||
                            selectedQuote.created_by_email ||
                            "Unknown user"}{" "}
                          on {new Date(selectedQuote.created_at).toLocaleString()}
                        </div>
                        <div style={{ fontSize: isMobile ? 22 : undefined, fontWeight: isMobile ? 800 : undefined }}>
                          <strong>Total:</strong> {formatMoney(selectedQuote.quote_total_cents)}
                        </div>
                        <div><strong>Service:</strong> {selectedQuote.service_name || "Quote"}</div>
                        <div><strong>ETA:</strong> {selectedQuote.eta || "N/A"}</div>
                        {selectedQuote.shipping_details ? (
                          <div><strong>Shipping Details:</strong> {selectedQuote.shipping_details}</div>
                        ) : null}
                        <div><strong>Summary:</strong> {selectedQuote.summary || "N/A"}</div>
                        <div><strong>Notes:</strong> {selectedQuote.description || "N/A"}</div>
                      </div>
                    ) : null}
                  </div>

                  <div style={{ display: "grid", gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => toggleDetailSection("lineItems")}
                      style={mobileActionButtonStyle}
                    >
                      {detailSectionsOpen.lineItems ? "Hide Line Items" : "Show Line Items"}
                    </button>
                    {detailSectionsOpen.lineItems ? (
                      <>
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
                                overflowWrap: "anywhere",
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
                      </>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: "#94a3b8" }}>Select a saved quote to review it.</div>
            )}
          </div>
        </div>
      </div>
      {isMobile ? (
        <div style={mobileBottomNavStyle}>
          {canAccess("quoteTool") ? (
            <a href={mobileDashboardHref} style={mobileTabLinkStyle(false)}>
            <span style={mobileTabIconStyle(false)}>D</span>
            <span>Dashboard</span>
          </a>
          ) : null}
          {canAccess("quoteTool") ? (
            <a href={quoteToolHref} style={mobileTabLinkStyle(false)}>
            <span style={mobileTabIconStyle(false)}>Q</span>
            <span>Quote Tool</span>
          </a>
          ) : null}
          <a href={isEmbeddedRoute ? "/app/quote-review" : "/quote-review"} style={mobileTabLinkStyle(true)}>
            <span style={mobileTabIconStyle(true)}>R</span>
            <span>Review</span>
          </a>
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
