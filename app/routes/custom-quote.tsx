import { useMemo, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { data, redirect } from "react-router";
import { getQuote } from "../lib/quote-engine.server";
import { saveCustomQuote } from "../lib/custom-quotes.server";
import {
  adminQuoteCookie,
  getAdminQuotePassword,
  hasAdminQuoteAccess,
} from "../lib/admin-quote-auth.server";
import { supabaseAdmin } from "../lib/supabase.server";

type ProductOption = {
  title: string;
  sku: string;
  vendor: string;
};

async function getProductOptions(): Promise<ProductOption[]> {
  const { data, error } = await supabaseAdmin
    .from("product_source_map")
    .select("sku, product_title, pickup_vendor")
    .order("product_title", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data
    .filter((row: any) => row.sku)
    .map((row: any) => ({
      title: row.product_title || row.sku,
      sku: row.sku,
      vendor: row.pickup_vendor || "",
    }));
}

function getSourceBreakdown(
  selectedLines: Array<{ title: string; sku: string; vendor: string; quantity: number }>,
) {
  const grouped = new Map<string, { vendor: string; quantity: number; items: string[] }>();

  for (const line of selectedLines) {
    const existing = grouped.get(line.vendor) || { vendor: line.vendor, quantity: 0, items: [] };
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
  const products = allowed ? await getProductOptions() : [];

  return data({
    allowed,
    products,
  });
}

export async function action({ request }: any) {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "login") {
    const password = String(form.get("password") || "");
    const expected = getAdminQuotePassword();

    if (!expected || password !== expected) {
      return data({ allowed: false, loginError: "Invalid password", products: [] }, { status: 401 });
    }

    const products = await getProductOptions();

    return data(
      { allowed: true, products },
      {
        headers: {
          "Set-Cookie": await adminQuoteCookie.serialize("ok"),
        },
      },
    );
  }

  const allowed = await hasAdminQuoteAccess(request);
  if (!allowed) {
    return data({ allowed: false, loginError: "Please log in" }, { status: 401 });
  }

  const products = await getProductOptions();

  const customerName = String(form.get("customerName") || "");
  const address1 = String(form.get("address1") || "");
  const address2 = String(form.get("address2") || "");
  const city = String(form.get("city") || "");
  const province = String(form.get("province") || "");
  const postalCode = String(form.get("postalCode") || "");
  const country = String(form.get("country") || "US");
  const rawLines = JSON.parse(String(form.get("linesJson") || "[]"));

  const items: Array<{ sku?: string; quantity: number; requiresShipping?: boolean; pickupVendor?: string }> = [];
  const selectedLines: Array<{ title: string; sku: string; vendor: string; quantity: number }> = [];

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
    return data({ allowed: true, products, ok: false, message: "Add at least one line." }, { status: 400 });
  }

  const quote = await getQuote({
    shop: process.env.SHOPIFY_STORE_DOMAIN || "darfaz-2e.myshopify.com",
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
      shop: process.env.SHOPIFY_STORE_DOMAIN || "darfaz-2e.myshopify.com",
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
    ok: true,
    quote,
    selectedLines,
    sourceBreakdown,
    savedQuoteId,
    customerName,
    address: { address1, address2, city, province, postalCode, country },
  });
}

export default function PublicCustomQuotePage() {
  const loaderData = useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const allowed = actionData?.allowed ?? loaderData.allowed;
  const products = actionData?.products ?? loaderData.products ?? [];

  const [searches, setSearches] = useState<string[]>([""]);
  const [lines, setLines] = useState<Array<{ sku: string; quantity: string }>>([{ sku: "", quantity: "" }]);

  const quoteText = useMemo(() => {
    if (!actionData?.quote) return "";
    const linesText =
      actionData.selectedLines?.map((line: any) => `${line.title} (${line.sku}) x ${line.quantity} — ${line.vendor}`).join("\n") || "";
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

  function updateLine(index: number, patch: Partial<{ sku: string; quantity: string }>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, { sku: "", quantity: "" }]);
    setSearches((prev) => [...prev, ""]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
    setSearches((prev) => prev.filter((_, i) => i !== index));
  }

  function filteredProducts(index: number) {
    const search = (searches[index] || "").toLowerCase().trim();
    if (!search) return products.slice(0, 40);

    return products
      .filter((product: ProductOption) =>
        `${product.title} ${product.sku} ${product.vendor}`.toLowerCase().includes(search),
      )
      .slice(0, 40);
  }

  async function copyQuote() {
    if (!quoteText) return;
    await navigator.clipboard.writeText(quoteText);
    alert("Quote copied");
  }

  if (!allowed) {
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", padding: 24, border: "1px solid #e5e7eb", borderRadius: 10 }}>
        <h1>Custom Quote Login</h1>
        <Form method="post" autoComplete="off">
          <input type="hidden" name="intent" value="login" />
          <label>
            Admin Password
            <br />
            <input type="password" name="password" style={{ width: "100%", marginTop: 6 }} />
          </label>
          {actionData?.loginError ? <div style={{ color: "#b91c1c", marginTop: 12 }}>{actionData.loginError}</div> : null}
          <button type="submit" style={{ marginTop: 16, padding: "10px 14px" }}>Unlock</button>
        </Form>
      </div>
    );
  }

  return (
    <div style={{ padding: 30, maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Custom Quote Tool</h1>
        <a href="/custom-quote?logout=1">Log out</a>
      </div>

      <Form method="post" style={{ display: "grid", gap: 20 }}>
        <input type="hidden" name="linesJson" value={JSON.stringify(lines)} />

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, display: "grid", gap: 14 }}>
          <label>
            Customer Name
            <br />
            <input type="text" name="customerName" defaultValue={actionData?.customerName || ""} style={{ width: "100%", marginTop: 6 }} />
          </label>

          <label>
            Address 1
            <br />
            <input type="text" name="address1" defaultValue={actionData?.address?.address1 || ""} style={{ width: "100%", marginTop: 6 }} />
          </label>

          <label>
            Address 2
            <br />
            <input type="text" name="address2" defaultValue={actionData?.address?.address2 || ""} style={{ width: "100%", marginTop: 6 }} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 140px 120px", gap: 16 }}>
            <input type="text" name="city" placeholder="City" defaultValue={actionData?.address?.city || ""} />
            <input type="text" name="province" placeholder="State" defaultValue={actionData?.address?.province || "WI"} />
            <input type="text" name="postalCode" placeholder="ZIP" defaultValue={actionData?.address?.postalCode || ""} />
            <input type="text" name="country" placeholder="Country" defaultValue={actionData?.address?.country || "US"} />
          </div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, display: "grid", gap: 14 }}>
          <h2 style={{ margin: 0 }}>Quote Lines</h2>

          {lines.map((line, index) => (
            <div key={index} style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: 14, display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) 140px 120px", gap: 12 }}>
                <input
                  type="text"
                  value={searches[index] || ""}
                  onChange={(e) => setSearches((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))}
                  placeholder="Search product, SKU, or vendor"
                />
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                />
                <button type="button" onClick={() => removeLine(index)} disabled={lines.length === 1}>Remove</button>
              </div>

              <select value={line.sku} onChange={(e) => updateLine(index, { sku: e.target.value })}>
                <option value="">Select product</option>
                {filteredProducts(index).map((product: ProductOption) => (
                  <option key={product.sku} value={product.sku}>
                    {product.title} ({product.sku}) — {product.vendor}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <button type="button" onClick={addLine}>Add Line</button>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button type="submit" name="intent" value="quote">{isSubmitting ? "Calculating..." : "Get Quote"}</button>
          <button type="submit" name="intent" value="save">{isSubmitting ? "Saving..." : "Save Quote"}</button>
        </div>
      </Form>

      {actionData?.savedQuoteId ? <div style={{ marginTop: 16 }}>Quote saved: {actionData.savedQuoteId}</div> : null}

      {actionData?.quote ? (
        <div style={{ marginTop: 24, display: "grid", gap: 18 }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>Quote Result</h2>
              <button type="button" onClick={copyQuote}>Copy Quote</button>
            </div>
            <div><strong>Service:</strong> {actionData.quote.serviceName}</div>
            <div><strong>Price:</strong> ${(actionData.quote.cents / 100).toFixed(2)}</div>
            <div><strong>Description:</strong> {actionData.quote.description}</div>
            <div><strong>ETA:</strong> {actionData.quote.eta}</div>
            <div><strong>Summary:</strong> {actionData.quote.summary}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}