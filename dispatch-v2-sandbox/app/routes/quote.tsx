import { useMemo, useState } from "react";
import { data, Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { PermissionNav } from "../components/PermissionNav";
import { requireDispatchUser } from "../lib/auth.server";
import {
  calculateDispatchQuote,
  loadDispatchB2BCompanies,
  loadDispatchQuoteProducts,
  type DispatchB2BCompany,
  type DispatchQuoteAudience,
  type DispatchQuoteProduct,
  type DispatchQuoteResult,
} from "../lib/dispatch.server";

type QuoteLineState = {
  id: string;
  sku: string;
  query: string;
  quantity: string;
  customPrice: string;
};

type QuoteActionData = {
  error?: string;
  result?: DispatchQuoteResult;
  customerName?: string;
  companyName?: string;
  customerEmail?: string;
  customerPhone?: string;
  billingAddress1?: string;
  billingAddress2?: string;
  billingCity?: string;
  billingProvince?: string;
  billingPostalCode?: string;
  billingCountry?: string;
  taxExempt?: boolean;
  address1?: string;
  city?: string;
  notes?: string;
};

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function quantityUnit(quantity: number, unitLabel: string) {
  const unit = String(unitLabel || "").replace(/^per\s+/i, "").trim();
  if (!unit) return String(quantity);
  const plural = quantity !== 1 && !unit.toLowerCase().endsWith("s") ? `${unit}s` : unit;
  return `${quantity} ${plural}`;
}

function copyQuoteText(result: DispatchQuoteResult) {
  const lines = result.lineItems.map(
    (line) => `${quantityUnit(line.quantity, line.unitLabel)} ${line.title}: ${money(line.lineTotal)}`,
  );

  return [
    ...lines,
    `Delivery Fee: ${money(result.deliveryTotal)}`,
    `Tax: ${money(result.taxTotal)}`,
    `Total: ${money(result.grandTotal)}`,
    "",
    "Please let us know if you have any questions or would like to proceed with your order.",
  ].join("\n");
}

function printableHtml(actionData: QuoteActionData) {
  const result = actionData.result;
  if (!result) return "";

  const customerLines = [
    actionData.companyName,
    actionData.customerName,
    actionData.customerEmail,
    actionData.customerPhone,
  ].filter(Boolean);
  const addressLines = [actionData.address1, actionData.city].filter(Boolean);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Green Hills Supply Quote</title>
  <style>
    body { margin: 0; color: #172033; font-family: Arial, Helvetica, sans-serif; background: #fff; }
    .quote { max-width: 880px; margin: 24px auto; border: 2px solid #111827; border-radius: 18px; overflow: hidden; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 26px 30px; border-bottom: 6px solid #8fd400; background: #f8fbf1; }
    img { width: 170px; max-height: 110px; object-fit: contain; }
    h1 { margin: 0; font-size: 34px; }
    section { padding: 22px 30px; border-bottom: 1px solid #d8dee8; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .label { color: #0f766e; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .box { border: 1px solid #cbd5e1; border-radius: 14px; padding: 14px; min-height: 92px; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #111827; color: #fff; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; text-align: left; padding: 11px; }
    td { border-bottom: 1px solid #d8dee8; padding: 12px 11px; }
    th:nth-child(n+2), td:nth-child(n+2) { text-align: right; white-space: nowrap; }
    .totals { max-width: 360px; margin-left: auto; display: grid; gap: 8px; }
    .totalRow { display: flex; justify-content: space-between; gap: 16px; font-weight: 800; }
    .grand { border-top: 3px solid #111827; padding-top: 12px; font-size: 22px; }
    .footer { background: #111827; color: #fff; font-weight: 700; }
  </style>
</head>
<body>
  <div class="quote">
    <header>
      <img src="/email-green-hills-logo.png" alt="Green Hills Supply" />
      <div>
        <h1>Delivery Quote</h1>
        <div>${new Date().toLocaleDateString()}</div>
      </div>
    </header>
    <section class="grid">
      <div>
        <div class="label">Customer</div>
        <div class="box">${customerLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("") || "Not provided"}</div>
      </div>
      <div>
        <div class="label">Delivery Address</div>
        <div class="box">${addressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("") || "Not provided"}</div>
      </div>
    </section>
    <section>
      <table>
        <thead><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
        <tbody>
          ${result.lineItems
            .map(
              (line) =>
                `<tr><td><strong>${escapeHtml(line.title)}</strong><br><small>${escapeHtml(line.sku)}</small></td><td>${escapeHtml(quantityUnit(line.quantity, line.unitLabel))}</td><td>${money(line.unitPrice)}</td><td>${money(line.lineTotal)}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>
    <section>
      <div class="totals">
        <div class="totalRow"><span>Products</span><span>${money(result.productTotal)}</span></div>
        <div class="totalRow"><span>Delivery</span><span>${money(result.deliveryTotal)}</span></div>
        <div class="totalRow"><span>Tax</span><span>${money(result.taxTotal)}</span></div>
        <div class="totalRow grand"><span>Total</span><span>${money(result.grandTotal)}</span></div>
      </div>
    </section>
    <section>
      <div class="label">Delivery Notes</div>
      <p>${escapeHtml(result.deliveryService)}: ${escapeHtml(result.deliveryNotes)}</p>
      ${actionData.notes ? `<p>${escapeHtml(actionData.notes)}</p>` : ""}
    </section>
    <section class="footer">Please let us know if you have any questions or would like to proceed with your order.</section>
  </div>
</body>
</html>`;
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseNumber(value: FormDataEntryValue | null) {
  if (value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request);
  const started = performance.now();
  const products = await loadDispatchQuoteProducts();
  const companies = await loadDispatchB2BCompanies();
  return data({
    products,
    companies,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

export async function action({ request }: { request: Request }) {
  await requireDispatchUser(request);
  const form = await request.formData();
  const audience = String(form.get("audience") || "customer") as DispatchQuoteAudience;
  const companyName = String(form.get("companyName") || "").trim();

  if (audience === "contractor" && !companyName) {
    return data({ error: "Company Name is required for contractor quotes." } satisfies QuoteActionData, { status: 400 });
  }

  const skus = form.getAll("lineSku").map(String);
  const quantities = form.getAll("lineQuantity");
  const customTitles = form.getAll("lineCustomTitle").map(String);
  const customPrices = form.getAll("lineCustomPrice");
  const lines = skus.map((sku, index) => ({
    sku,
    quantity: Number(quantities[index] || 0),
    customTitle: customTitles[index] || "",
    customUnitPrice: parseNumber(customPrices[index] || null),
  })).filter((line) => line.sku && line.quantity > 0);

  if (!lines.length) {
    return data({ error: "Add at least one product with a quantity." } satisfies QuoteActionData, { status: 400 });
  }

  const input = {
    audience,
    contractorTier: String(form.get("contractorTier") || "tier1") as "tier1" | "tier2",
    companyName,
    taxExempt: String(form.get("taxExempt") || "") === "1",
    customerName: String(form.get("customerName") || ""),
    customerEmail: String(form.get("customerEmail") || ""),
    customerPhone: String(form.get("customerPhone") || ""),
    billingAddress1: String(form.get("billingAddress1") || ""),
    billingAddress2: String(form.get("billingAddress2") || ""),
    billingCity: String(form.get("billingCity") || ""),
    billingProvince: String(form.get("billingProvince") || ""),
    billingPostalCode: String(form.get("billingPostalCode") || ""),
    billingCountry: String(form.get("billingCountry") || ""),
    address1: String(form.get("address1") || ""),
    city: String(form.get("city") || ""),
    notes: String(form.get("notes") || ""),
    customShippingLabel: String(form.get("customShippingLabel") || "Custom Shipping"),
    customShippingQuantity: parseNumber(form.get("customShippingQuantity")),
    customShippingRate: parseNumber(form.get("customShippingRate")),
    lines,
  };

  const result = await calculateDispatchQuote(input);
  return data({ ...input, result } satisfies QuoteActionData);
}

export default function QuotePage() {
  const { products, companies, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as QuoteActionData | undefined;
  const navigation = useNavigation();
  const [audience, setAudience] = useState<DispatchQuoteAudience>("customer");
  const [lines, setLines] = useState<QuoteLineState[]>([
    { id: "line-1", sku: "", query: "", quantity: "1", customPrice: "" },
  ]);
  const [copied, setCopied] = useState(false);
  const [contractorTier, setContractorTier] = useState<"tier1" | "tier2">("tier1");
  const [companyName, setCompanyName] = useState(actionData?.companyName || "");
  const [customerName, setCustomerName] = useState(actionData?.customerName || "");
  const [customerEmail, setCustomerEmail] = useState(actionData?.customerEmail || "");
  const [customerPhone, setCustomerPhone] = useState(actionData?.customerPhone || "");
  const [billingAddress1, setBillingAddress1] = useState(actionData?.billingAddress1 || "");
  const [billingAddress2, setBillingAddress2] = useState(actionData?.billingAddress2 || "");
  const [billingCity, setBillingCity] = useState(actionData?.billingCity || "");
  const [billingProvince, setBillingProvince] = useState(actionData?.billingProvince || "");
  const [billingPostalCode, setBillingPostalCode] = useState(actionData?.billingPostalCode || "");
  const [billingCountry, setBillingCountry] = useState(actionData?.billingCountry || "US");
  const [taxExempt, setTaxExempt] = useState(Boolean(actionData?.taxExempt));
  const isWorking = navigation.state !== "idle";

  const productBySku = useMemo(() => new Map(products.map((product) => [product.sku, product])), [products]);
  const optionByLabel = useMemo(() => {
    const entries = products.flatMap((product) => [
      [`${product.title} (${product.sku})`, product] as const,
      [product.sku, product] as const,
    ]);
    return new Map(entries);
  }, [products]);
  const companyByName = useMemo(
    () => new Map((companies as DispatchB2BCompany[]).map((company) => [company.companyName, company])),
    [companies],
  );

  function applyCompany(company: DispatchB2BCompany) {
    setCompanyName(company.companyName);
    setCustomerName(company.contactName || "");
    setCustomerEmail(company.email || "");
    setCustomerPhone(company.phone || "");
    setBillingAddress1(company.billingAddress1 || "");
    setBillingAddress2(company.billingAddress2 || "");
    setBillingCity(company.billingCity || "");
    setBillingProvince(company.billingProvince || "WI");
    setBillingPostalCode(company.billingPostalCode || "");
    setBillingCountry(company.billingCountry || "US");
    setTaxExempt(Boolean(company.taxExempt));
    setContractorTier(company.contractorTier || "tier1");
  }

  function addLine() {
    setLines((current) => [
      ...current,
      { id: `line-${Date.now()}-${current.length}`, sku: "", query: "", quantity: "1", customPrice: "" },
    ]);
  }

  function updateLine(id: string, patch: Partial<QuoteLineState>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function removeLine(id: string) {
    setLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== id));
  }

  async function copyQuote() {
    if (!actionData?.result) return;
    await navigator.clipboard.writeText(copyQuoteText(actionData.result));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function printQuote() {
    if (!actionData?.result) return;
    const popup = window.open("", "_blank", "width=920,height=720");
    if (!popup) return;
    popup.document.write(printableHtml(actionData));
    popup.document.close();
    popup.focus();
    popup.print();
  }

  return (
    <main className="page quotePage">
      <header className="topbar">
        <div>
          <p className="eyebrow">Quote Tool</p>
          <h1>Build a delivery quote</h1>
          <p className="muted">Integrated v2 quoting using synced Shopify products and dispatch route timing.</p>
        </div>
        <div className="topbarActions">
          <PermissionNav />
          <div className="statusBox">
            <strong>{loadMs}ms</strong>
            <span>server load</span>
            <small>{new Date(loadedAt).toLocaleTimeString()}</small>
          </div>
        </div>
      </header>

      {actionData?.error ? <section className="notice error">{actionData.error}</section> : null}

      <section className="quoteLayout">
        <Form method="post" className="panel quoteForm">
          <datalist id="quote-b2b-companies">
            {(companies as DispatchB2BCompany[]).map((company) => (
              <option key={company.id} value={company.companyName} />
            ))}
          </datalist>
          <div className="quoteTabs" role="tablist" aria-label="Pricing type">
            {(["customer", "contractor", "custom"] as DispatchQuoteAudience[]).map((option) => (
              <label key={option} className={audience === option ? "quoteTab active" : "quoteTab"}>
                <input
                  type="radio"
                  name="audience"
                  value={option}
                  checked={audience === option}
                  onChange={() => setAudience(option)}
                />
                {option === "customer" ? "Customer" : option === "contractor" ? "Contractor" : "Custom"}
              </label>
            ))}
          </div>

          {audience === "contractor" ? (
            <section className="quoteCompanyBlock">
              <label>
                Company Name <span className="required">*</span>
                <input
                  name="companyName"
                  list="quote-b2b-companies"
                  required
                  placeholder="Search Shopify B2B company"
                  value={companyName}
                  onChange={(event) => {
                    const nextName = event.currentTarget.value;
                    setCompanyName(nextName);
                    const company = companyByName.get(nextName);
                    if (company) applyCompany(company);
                  }}
                />
              </label>
              <input type="hidden" name="taxExempt" value={taxExempt ? "1" : "0"} />
              {taxExempt ? <p className="muted">Tax exempt company selected. Product tax will not be added.</p> : null}
            </section>
          ) : (
            <>
              <input type="hidden" name="companyName" value="" />
              <input type="hidden" name="taxExempt" value="0" />
            </>
          )}

          {audience === "contractor" ? (
            <label>
              Contractor Tier
              <select
                name="contractorTier"
                value={contractorTier}
                onChange={(event) => setContractorTier(event.currentTarget.value as "tier1" | "tier2")}
              >
                <option value="tier1">Tier 1</option>
                <option value="tier2">Tier 2</option>
              </select>
            </label>
          ) : (
            <input type="hidden" name="contractorTier" value="tier1" />
          )}

          <div className="formGrid two">
            <label>
              Customer Name
              <input name="customerName" placeholder="Customer name" value={customerName} onChange={(event) => setCustomerName(event.currentTarget.value)} />
            </label>
            <label>
              Email
              <input name="customerEmail" type="email" placeholder="name@example.com" value={customerEmail} onChange={(event) => setCustomerEmail(event.currentTarget.value)} />
            </label>
            <label>
              Phone
              <input name="customerPhone" placeholder="262-000-0000" value={customerPhone} onChange={(event) => setCustomerPhone(event.currentTarget.value)} />
            </label>
            {audience === "contractor" ? (
              <>
                <label>
                  Billing Address
                  <input name="billingAddress1" placeholder="Billing street address" value={billingAddress1} onChange={(event) => setBillingAddress1(event.currentTarget.value)} />
                </label>
                <label>
                  Billing Address 2
                  <input name="billingAddress2" placeholder="Suite, unit, etc." value={billingAddress2} onChange={(event) => setBillingAddress2(event.currentTarget.value)} />
                </label>
                <label>
                  Billing City
                  <input name="billingCity" placeholder="City" value={billingCity} onChange={(event) => setBillingCity(event.currentTarget.value)} />
                </label>
                <label>
                  Billing State
                  <input name="billingProvince" placeholder="WI" value={billingProvince} onChange={(event) => setBillingProvince(event.currentTarget.value)} />
                </label>
                <label>
                  Billing ZIP
                  <input name="billingPostalCode" placeholder="53051" value={billingPostalCode} onChange={(event) => setBillingPostalCode(event.currentTarget.value)} />
                </label>
                <label>
                  Billing Country
                  <input name="billingCountry" placeholder="US" value={billingCountry} onChange={(event) => setBillingCountry(event.currentTarget.value)} />
                </label>
              </>
            ) : null}
            <label>
              Delivery Address
              <input name="address1" placeholder="Street address" />
            </label>
            <label>
              City / State / ZIP
              <input name="city" placeholder="Menomonee Falls, WI 53051" />
            </label>
          </div>

          <div className="quoteLines">
            <div className="sectionHeader">
              <h2>Products</h2>
              <button type="button" className="secondaryButton compact" onClick={addLine}>Add Product</button>
            </div>
            <datalist id="quote-products">
              {products.map((product) => (
                <option key={product.sku} value={`${product.title} (${product.sku})`} />
              ))}
            </datalist>
            {lines.map((line) => {
              const product = productBySku.get(line.sku);
              return (
                <div className="quoteLine" key={line.id}>
                  <input type="hidden" name="lineSku" value={line.sku} />
                  <input type="hidden" name="lineCustomTitle" value={product?.title || line.query} />
                  <label className="productSearch">
                    Search Product
                    <input
                      list="quote-products"
                      value={line.query}
                      placeholder="Type product name or SKU"
                      onChange={(event) => {
                        const query = event.target.value;
                        const productMatch = optionByLabel.get(query) ||
                          products.find((candidate) => candidate.sku.toLowerCase() === query.toLowerCase()) ||
                          null;
                        updateLine(line.id, {
                          query,
                          sku: productMatch?.sku || line.sku,
                        });
                      }}
                    />
                  </label>
                  <label>
                    Quantity
                    <input name="lineQuantity" min="1" step="1" type="number" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} />
                  </label>
                  {audience === "custom" ? (
                    <label>
                      Unit Price
                      <input name="lineCustomPrice" min="0" step="0.01" type="number" value={line.customPrice} onChange={(event) => updateLine(line.id, { customPrice: event.target.value })} />
                    </label>
                  ) : (
                    <input type="hidden" name="lineCustomPrice" value="" />
                  )}
                  <button type="button" className="secondaryButton compact" onClick={() => removeLine(line.id)}>Remove</button>
                  {product ? (
                    <div className="selectedProduct">
                      {product.imageUrl ? <img src={product.imageUrl} alt="" /> : null}
                      <div>
                        <strong>{product.title}</strong>
                        <span>{product.sku} · {product.vendor || "Green Hills Supply"} · {product.unitLabel || "Unit"}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="formGrid three">
            <label>
              Shipping Label
              <input name="customShippingLabel" defaultValue="Custom Shipping" />
            </label>
            <label>
              Miles / Hours
              <input name="customShippingQuantity" min="0" step="0.01" type="number" placeholder="Optional" />
            </label>
            <label>
              Price
              <input name="customShippingRate" min="0" step="0.01" type="number" placeholder="Optional" />
            </label>
          </div>

          <label>
            Notes
            <textarea name="notes" rows={3} placeholder="Quote notes or special instructions" />
          </label>

          <button className="primaryButton" type="submit" disabled={isWorking}>
            {isWorking ? "Calculating..." : "Get Full Quote"}
          </button>
        </Form>

        <aside className="quoteResultColumn">
          <section className="panel quoteResult">
            <div className="sectionHeader">
              <h2>Full Quote Result</h2>
              <div className="buttonRow">
                <button className="secondaryButton compact" type="button" onClick={copyQuote} disabled={!actionData?.result}>
                  {copied ? "Copied" : "Copy Quote"}
                </button>
                <button className="secondaryButton compact" type="button" onClick={printQuote} disabled={!actionData?.result}>
                  Print
                </button>
              </div>
            </div>
            {actionData?.result ? (
              <>
                <p><strong>Pricing:</strong> {actionData.result.pricingLabel}</p>
                <p><strong>Products:</strong> {money(actionData.result.productTotal)}</p>
                <p><strong>Delivery:</strong> {money(actionData.result.deliveryTotal)}</p>
                <p><strong>Tax:</strong> {money(actionData.result.taxTotal)}</p>
                <hr />
                <h3>TOTAL: {money(actionData.result.grandTotal)}</h3>
                <p><strong>Delivery Service:</strong> {actionData.result.deliveryService}</p>
                <p><strong>Notes:</strong> {actionData.result.deliveryNotes}</p>
              </>
            ) : (
              <p className="muted">Fill in products and click Get Full Quote to calculate totals.</p>
            )}
          </section>

          <section className="panel sourceBreakdown">
            <h2>Source Breakdown</h2>
            {actionData?.result?.sourceBreakdown.length ? (
              actionData.result.sourceBreakdown.map((source) => (
                <div className="sourceCard" key={source.vendor}>
                  <strong>{source.vendor || "Green Hills Supply"}</strong>
                  <span>Total Qty: {source.quantity}</span>
                  <small>{source.items.join(", ")}</small>
                </div>
              ))
            ) : (
              <p className="muted">Sources appear after a quote is calculated.</p>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
