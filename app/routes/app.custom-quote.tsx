import { useMemo, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { getQuote } from "../lib/quote-engine.server";
import { saveCustomQuote } from "../lib/custom-quotes.server";
import {
  getProductOptionsFromShopify,
  syncProductOptionsToSupabase,
  type QuoteProductOption,
} from "../lib/quote-products.server";

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
    {
      vendor: string;
      quantity: number;
      items: string[];
    }
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
  const { admin, session } = await authenticate.admin(request);

  const products = await getProductOptionsFromShopify(admin);
  await syncProductOptionsToSupabase(products);

  return data({
    shop: session.shop,
    products,
  });
}

export async function action({ request }: any) {
  const { admin, session } = await authenticate.admin(request);
  const products = await getProductOptionsFromShopify(admin);
  await syncProductOptionsToSupabase(products);

  const form = await request.formData();

  const intent = String(form.get("intent") || "quote");
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
      { ok: false, message: "Add at least one line with quantity greater than 0." },
      { status: 400 },
    );
  }

  if (!address1 || !city || !province || !postalCode) {
    return data(
      { ok: false, message: "Address 1, city, state, and ZIP are required." },
      { status: 400 },
    );
  }

  const quote = await getQuote({
    shop: session.shop,
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
      shop: session.shop,
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
    ok: true,
    quote,
    selectedLines,
    sourceBreakdown,
    savedQuoteId,
    customerName,
    address: { address1, address2, city, province, postalCode, country },
  });
}

export default function CustomQuotePage() {
  const { products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [searches, setSearches] = useState<string[]>([""]);
  const [lines, setLines] = useState<Array<{ sku: string; quantity: string }>>([
    { sku: "", quantity: "" },
  ]);

  const quoteText = useMemo(() => {
    if (!actionData?.quote) return "";

    const linesText =
      actionData.selectedLines
        ?.map(
          (line: any) =>
            `${line.title} (${line.sku}) x ${line.quantity} — ${line.vendor}`,
        )
        .join("\n") || "";

    const sourcesText =
      actionData.sourceBreakdown
        ?.map(
          (source: any) =>
            `${source.vendor}: qty ${source.quantity} | ${source.items.join(", ")}`,
        )
        .join("\n") || "";

    return [
      `Service: ${actionData.quote.serviceName}`,
      `Price: $${(actionData.quote.cents / 100).toFixed(2)}`,
      `Description: ${actionData.quote.description}`,
      `ETA: ${actionData.quote.eta}`,
      `Summary: ${actionData.quote.summary}`,
      "",
      "Products:",
      linesText,
      "",
      "Source Breakdown:",
      sourcesText,
    ].join("\n");
  }, [actionData]);

  function updateLine(index: number, patch: Partial<{ sku: string; quantity: string }>) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
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
      .filter((product: QuoteProductOption) =>
        `${product.title} ${product.sku} ${product.vendor}`
          .toLowerCase()
          .includes(search),
      )
      .slice(0, 40);
  }

  async function copyQuote() {
    if (!quoteText) return;
    await navigator.clipboard.writeText(quoteText);
    alert("Quote copied");
  }

  return (
    <div style={{ padding: 30, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Custom Quote Tool</h1>
      <p style={{ marginBottom: 24 }}>
        Build a multi-line quote using the same delivery logic as checkout.
      </p>

      <Form method="post" style={{ display: "grid", gap: 20 }}>
        <input type="hidden" name="linesJson" value={JSON.stringify(lines)} />

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            padding: 20,
            display: "grid",
            gap: 14,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20 }}>Customer / Delivery Address</h2>

          <label>
            Customer Name
            <br />
            <input
              type="text"
              name="customerName"
              autoComplete="name"
              defaultValue={actionData?.customerName || ""}
              style={{ width: "100%", marginTop: 6 }}
            />
          </label>

          <label>
            Address 1
            <br />
            <input
              type="text"
              name="address1"
              autoComplete="street-address"
              defaultValue={actionData?.address?.address1 || ""}
              style={{ width: "100%", marginTop: 6 }}
            />
          </label>

          <label>
            Address 2
            <br />
            <input
              type="text"
              name="address2"
              autoComplete="address-line2"
              defaultValue={actionData?.address?.address2 || ""}
              style={{ width: "100%", marginTop: 6 }}
            />
          </label>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 140px 140px 120px",
              gap: 16,
            }}
          >
            <label>
              City
              <br />
              <input
                type="text"
                name="city"
                autoComplete="address-level2"
                defaultValue={actionData?.address?.city || ""}
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>

            <label>
              State
              <br />
              <input
                type="text"
                name="province"
                autoComplete="address-level1"
                defaultValue={actionData?.address?.province || "WI"}
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>

            <label>
              ZIP
              <br />
              <input
                type="text"
                name="postalCode"
                autoComplete="postal-code"
                defaultValue={actionData?.address?.postalCode || ""}
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>

            <label>
              Country
              <br />
              <input
                type="text"
                name="country"
                autoComplete="country-name"
                defaultValue={actionData?.address?.country || "US"}
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            padding: 20,
            display: "grid",
            gap: 14,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20 }}>Quote Lines</h2>

          {lines.map((line, index) => (
            <div
              key={index}
              style={{
                border: "1px solid #f1f5f9",
                borderRadius: 8,
                padding: 14,
                display: "grid",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(320px, 1fr) 140px 120px",
                  gap: 12,
                  alignItems: "end",
                }}
              >
                <label>
                  Search Product
                  <br />
                  <input
                    type="text"
                    value={searches[index] || ""}
                    onChange={(e) =>
                      setSearches((prev) =>
                        prev.map((value, i) =>
                          i === index ? e.target.value : value,
                        ),
                      )
                    }
                    placeholder="Type product, SKU, or vendor"
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </label>

                <label>
                  Quantity
                  <br />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={line.quantity}
                    onChange={(e) =>
                      updateLine(index, { quantity: e.target.value })
                    }
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  disabled={lines.length === 1}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                    background: "#fff",
                  }}
                >
                  Remove
                </button>
              </div>

              {searches[index]?.trim() ? (
                <div
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    maxHeight: 220,
                    overflowY: "auto",
                    background: "#fff",
                  }}
                >
                  {filteredProducts(index).length === 0 ? (
                    <div style={{ padding: 12, color: "#6b7280" }}>
                      No matching products
                    </div>
                  ) : (
                    filteredProducts(index).map((product: QuoteProductOption) => (
                      <button
                        key={product.sku}
                        type="button"
                        onClick={() => {
                          updateLine(index, { sku: product.sku });
                          setSearches((prev) =>
                            prev.map((value, i) =>
                              i === index
                                ? `${product.title} (${product.sku}) — ${product.vendor}`
                                : value,
                            ),
                          );
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: 12,
                          border: "none",
                          borderBottom: "1px solid #f3f4f6",
                          background: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{product.title}</div>
                        <div style={{ fontSize: 13, color: "#6b7280" }}>
                          {product.sku} — {product.vendor}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              <input type="hidden" value={line.sku} readOnly />
            </div>
          ))}

          <button
            type="button"
            onClick={addLine}
            style={{
              width: 160,
              padding: "10px 14px",
              background: "#fff",
              border: "1px solid #d1d5db",
              borderRadius: 6,
            }}
          >
            Add Line
          </button>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="submit"
            name="intent"
            value="quote"
            disabled={isSubmitting}
            style={{
              width: 180,
              padding: "10px 14px",
              background: "#111",
              color: "#fff",
              border: "none",
              borderRadius: 6,
            }}
          >
            {isSubmitting ? "Calculating..." : "Get Quote"}
          </button>

          <button
            type="submit"
            name="intent"
            value="save"
            disabled={isSubmitting}
            style={{
              width: 180,
              padding: "10px 14px",
              background: "#0f766e",
              color: "#fff",
              border: "none",
              borderRadius: 6,
            }}
          >
            {isSubmitting ? "Saving..." : "Save Quote"}
          </button>
        </div>
      </Form>

      {actionData?.message ? (
        <div
          style={{
            marginTop: 20,
            padding: "12px 14px",
            borderRadius: 8,
            background: actionData.ok ? "#f0fdf4" : "#fef2f2",
            border: "1px solid",
            borderColor: actionData.ok ? "#16a34a" : "#dc2626",
          }}
        >
          {actionData.message}
        </div>
      ) : null}

      {actionData?.savedQuoteId ? (
        <div
          style={{
            marginTop: 20,
            padding: "12px 14px",
            borderRadius: 8,
            background: "#eff6ff",
            border: "1px solid #60a5fa",
          }}
        >
          Quote saved successfully. ID: {actionData.savedQuoteId}
        </div>
      ) : null}

      {actionData?.quote ? (
        <div style={{ marginTop: 24, display: "grid", gap: 18 }}>
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 20,
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
            >
              <h2 style={{ margin: 0 }}>Quote Result</h2>
              <button
                type="button"
                onClick={copyQuote}
                style={{
                  padding: "10px 14px",
                  background: "#fff",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                }}
              >
                Copy Quote
              </button>
            </div>

            <div>
              <strong>Service:</strong> {actionData.quote.serviceName}
            </div>
            <div>
              <strong>Price:</strong> ${(actionData.quote.cents / 100).toFixed(2)}
            </div>
            <div>
              <strong>Description:</strong> {actionData.quote.description}
            </div>
            <div>
              <strong>ETA:</strong> {actionData.quote.eta}
            </div>
            <div>
              <strong>Summary:</strong> {actionData.quote.summary}
            </div>
          </div>

          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 20,
              display: "grid",
              gap: 12,
            }}
          >
            <h2 style={{ margin: 0 }}>Source Breakdown</h2>

            {actionData.sourceBreakdown.map((source: any, index: number) => (
              <div
                key={`${source.vendor}-${index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "220px 140px 1fr",
                  gap: 12,
                }}
              >
                <div>{source.vendor}</div>
                <div>{source.quantity}</div>
                <div>{source.items.join(", ")}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}