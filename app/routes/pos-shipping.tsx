import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { data, useLoaderData } from "react-router";
import {
  attachAddressAutocomplete,
  loadGooglePlaces,
} from "../lib/google-places";

type LoaderData = {
  googleMapsApiKey: string;
  shop: string;
};

type EstimateResult = {
  summary?: string;
  eta?: string;
  description?: string;
  cents?: number;
  serviceName?: string;
  outsideDeliveryArea?: boolean;
  outsideDeliveryMiles?: number;
  outsideDeliveryRadius?: number;
  outsideDeliveryPhone?: string;
};

const quickMaterials = [
  { label: "Aggregate", sku: "100" },
  { label: "Mulch", sku: "300" },
  { label: "Soil", sku: "400" },
  { label: "Field Run", sku: "499" },
];

function getBrowserGoogleMapsApiKey() {
  return (
    process.env.GOOGLE_MAPS_BROWSER_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ""
  );
}

function formatMoney(cents?: number) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

export async function loader() {
  return data<LoaderData>({
    googleMapsApiKey: getBrowserGoogleMapsApiKey(),
    shop: process.env.SHOPIFY_STORE_DOMAIN || "darfaz-2e.myshopify.com",
  });
}

export default function PosShippingCalculator() {
  const { googleMapsApiKey, shop } = useLoaderData<typeof loader>();
  const [address1, setAddress1] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("WI");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");
  const [sku, setSku] = useState("100");
  const [quantity, setQuantity] = useState("1");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const autocompleteAttached = useRef(false);

  useEffect(() => {
    if (!googleMapsApiKey || autocompleteAttached.current) return;

    loadGooglePlaces(googleMapsApiKey)
      .then(() => {
        attachAddressAutocomplete({
          address1Id: "pos-address1",
          cityId: "pos-city",
          provinceId: "pos-province",
          postalCodeId: "pos-postalCode",
          countryId: "pos-country",
        });
        autocompleteAttached.current = true;
      })
      .catch((placeError) => {
        console.error("[POS SHIPPING PLACES]", placeError);
      });
  }, [googleMapsApiKey]);

  const copyText = useMemo(() => {
    if (!result) return "";

    const lines = [
      `Delivery Fee: ${formatMoney(result.cents)}`,
      result.serviceName ? `Service: ${result.serviceName}` : "",
      result.eta ? `ETA: ${result.eta}` : "",
      result.description ? `Notes: ${result.description}` : "",
    ].filter(Boolean);

    if (result.outsideDeliveryArea) {
      lines.push(
        `Outside delivery area. Call ${result.outsideDeliveryPhone || "(262) 345-4001"}.`,
      );
    }

    return lines.join("\n");
  }, [result]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submittedAddress1 = String(form.get("address1") || address1).trim();
    const submittedCity = String(form.get("city") || city).trim();
    const submittedProvince = String(form.get("province") || province).trim();
    const submittedPostalCode = String(form.get("postalCode") || postalCode).trim();
    const submittedCountry = String(form.get("country") || country).trim() || "US";
    const submittedSku = String(form.get("sku") || sku).trim();
    const submittedQuantity = String(form.get("quantity") || quantity).trim();

    setIsLoading(true);
    setError("");
    setResult(null);
    setCopied(false);

    try {
      const response = await fetch(`/api/shipping-estimate?shop=${encodeURIComponent(shop)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          shippingAddress: {
            address1: submittedAddress1,
            city: submittedCity,
            provinceCode: submittedProvince,
            zip: submittedPostalCode,
            countryCode: submittedCountry,
          },
          lines: [
            {
              sku: submittedSku,
              quantity: Math.max(1, Number(submittedQuantity) || 1),
              grams: 0,
              price: 0,
              requiresShipping: true,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Shipping estimate failed (${response.status})`);
      }

      setResult((await response.json()) as EstimateResult);
    } catch (estimateError) {
      setError(
        estimateError instanceof Error
          ? estimateError.message
          : "Unable to calculate delivery.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function copyEstimate() {
    if (!copyText) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
  }

  return (
    <main className="pos-shell">
      <style>{styles}</style>
      <section className="hero-card">
        <div>
          <p className="eyebrow">Green Hills Supply</p>
          <h1>POS Shipping Calculator</h1>
          <p className="subhead">
            Fast delivery pricing for Counterpoint. Enter the jobsite and load,
            then copy the fee back into the sale.
          </p>
        </div>
        <div className="hero-badge">Register ready</div>
      </section>

      <section className="calculator-grid">
        <form className="entry-card" onSubmit={handleSubmit}>
          <div className="section-heading">
            <span>1</span>
            <div>
              <h2>Delivery Address</h2>
              <p>Start typing the street address, or fill it manually.</p>
            </div>
          </div>

          <label>
            Street Address
            <input
              id="pos-address1"
              name="address1"
              autoComplete="street-address"
              value={address1}
              onChange={(event) => setAddress1(event.target.value)}
              placeholder="W185 N7487 Narrow Ln"
              required
            />
          </label>

          <div className="field-row three">
            <label>
              City
              <input
                id="pos-city"
                name="city"
                autoComplete="address-level2"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Menomonee Falls"
                required
              />
            </label>
            <label>
              State
              <input
                id="pos-province"
                name="province"
                autoComplete="address-level1"
                value={province}
                onChange={(event) => setProvince(event.target.value.toUpperCase())}
                required
              />
            </label>
            <label>
              ZIP
              <input
                id="pos-postalCode"
                name="postalCode"
                autoComplete="postal-code"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                placeholder="53051"
                required
              />
            </label>
          </div>

          <input
            id="pos-country"
            name="country"
            type="hidden"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          />

          <div className="section-heading compact">
            <span>2</span>
            <div>
              <h2>Load</h2>
              <p>Use a synced SKU/prefix so the calculator picks the right rule.</p>
            </div>
          </div>

          <div className="quick-buttons">
            {quickMaterials.map((material) => (
              <button
                key={material.sku}
                type="button"
                className={sku === material.sku ? "active" : ""}
                onClick={() => setSku(material.sku)}
              >
                {material.label}
              </button>
            ))}
          </div>

          <div className="field-row load-row">
            <label>
              SKU or Prefix
              <input
                value={sku}
                name="sku"
                onChange={(event) => setSku(event.target.value)}
                placeholder="100, 300, 400..."
                required
              />
            </label>
            <label>
              Quantity
              <input
                type="number"
                name="quantity"
                min="1"
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
              />
            </label>
          </div>

          {error ? <p className="error-box">{error}</p> : null}

          <button className="primary-action" disabled={isLoading} type="submit">
            {isLoading ? "Calculating..." : "Calculate Shipping"}
          </button>
        </form>

        <aside className="result-card">
          <p className="eyebrow">Result</p>
          {result ? (
            <>
              <div className="price">{formatMoney(result.cents)}</div>
              <h2>{result.serviceName || "Green Hills Delivery"}</h2>
              <p className="result-summary">
                {result.outsideDeliveryArea
                  ? `Outside the ${result.outsideDeliveryRadius || 50} mile delivery area.`
                  : result.description || result.summary}
              </p>

              <dl>
                <div>
                  <dt>ETA</dt>
                  <dd>{result.eta || "2-4 business days"}</dd>
                </div>
                <div>
                  <dt>Distance Check</dt>
                  <dd>
                    {result.outsideDeliveryMiles
                      ? `${result.outsideDeliveryMiles.toFixed(1)} mi`
                      : "Within standard range"}
                  </dd>
                </div>
              </dl>

              {result.outsideDeliveryArea ? (
                <div className="callout">
                  Call {result.outsideDeliveryPhone || "(262) 345-4001"} for a
                  custom quote.
                </div>
              ) : null}

              <button className="copy-action" type="button" onClick={copyEstimate}>
                {copied ? "Copied" : "Copy for POS"}
              </button>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">GH</div>
              <h2>Ready for a shipping check</h2>
              <p>
                The delivery fee will appear here with a one-click copy button
                for the counter team.
              </p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

const styles = `
  :root {
    color-scheme: light;
    --ink: #102033;
    --muted: #697586;
    --line: #dfe8f0;
    --blue: #0496c7;
    --green: #8ed500;
    --orange: #ff6a1a;
    --paper: rgba(255, 255, 255, 0.92);
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background:
      radial-gradient(circle at 12% 8%, rgba(142, 213, 0, 0.22), transparent 32rem),
      radial-gradient(circle at 85% 15%, rgba(4, 150, 199, 0.2), transparent 30rem),
      linear-gradient(135deg, #f8fbef 0%, #edf7fc 46%, #fff6ec 100%);
    color: var(--ink);
    font-family: Avenir Next, Montserrat, Trebuchet MS, sans-serif;
    min-width: 320px;
  }

  .pos-shell {
    width: min(1180px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 28px 0;
  }

  .hero-card,
  .entry-card,
  .result-card {
    border: 1px solid rgba(16, 32, 51, 0.12);
    border-radius: 28px;
    background: var(--paper);
    box-shadow: 0 24px 70px rgba(27, 49, 75, 0.14);
  }

  .hero-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 28px;
    margin-bottom: 18px;
  }

  .eyebrow {
    margin: 0 0 8px;
    color: var(--orange);
    font-size: 0.76rem;
    font-weight: 900;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin-top: 0;
  }

  h1 {
    margin-bottom: 8px;
    font-size: clamp(2rem, 5vw, 4.5rem);
    line-height: 0.92;
    letter-spacing: -0.06em;
  }

  .subhead {
    max-width: 700px;
    margin-bottom: 0;
    color: var(--muted);
    font-size: 1.05rem;
    line-height: 1.55;
  }

  .hero-badge {
    flex: 0 0 auto;
    border-radius: 999px;
    background: #102033;
    color: #fff;
    padding: 14px 18px;
    font-weight: 900;
  }

  .calculator-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(340px, 0.65fr);
    gap: 18px;
  }

  .entry-card,
  .result-card {
    padding: 28px;
  }

  .section-heading {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 18px;
  }

  .section-heading.compact {
    margin-top: 26px;
  }

  .section-heading span {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border-radius: 16px;
    background: linear-gradient(135deg, var(--green), #37b34a);
    color: #0b1f11;
    font-weight: 950;
  }

  .section-heading h2 {
    margin-bottom: 2px;
    font-size: 1.2rem;
  }

  .section-heading p {
    margin-bottom: 0;
    color: var(--muted);
  }

  label {
    display: grid;
    gap: 8px;
    margin-bottom: 14px;
    color: #263447;
    font-size: 0.82rem;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  input {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: #fff;
    color: var(--ink);
    font: inherit;
    font-size: 1.08rem;
    font-weight: 700;
    outline: none;
    padding: 17px 18px;
    transition: border-color 160ms ease, box-shadow 160ms ease;
  }

  input:focus {
    border-color: var(--blue);
    box-shadow: 0 0 0 4px rgba(4, 150, 199, 0.14);
  }

  .field-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .field-row.three {
    grid-template-columns: minmax(0, 1.6fr) minmax(90px, 0.55fr) minmax(120px, 0.8fr);
  }

  .field-row.load-row {
    grid-template-columns: minmax(0, 1fr) 180px;
  }

  .quick-buttons {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }

  .quick-buttons button,
  .primary-action,
  .copy-action {
    border: 0;
    border-radius: 16px;
    cursor: pointer;
    font: inherit;
    font-weight: 950;
  }

  .quick-buttons button {
    border: 1px solid var(--line);
    background: #fff;
    color: var(--ink);
    padding: 13px 10px;
  }

  .quick-buttons button.active {
    border-color: transparent;
    background: #102033;
    color: #fff;
  }

  .primary-action,
  .copy-action {
    width: 100%;
    min-height: 58px;
    background: linear-gradient(135deg, var(--orange), #ff4f7a);
    color: #fff;
    font-size: 1.05rem;
    box-shadow: 0 16px 34px rgba(255, 106, 26, 0.28);
  }

  .primary-action:disabled {
    cursor: wait;
    opacity: 0.7;
  }

  .result-card {
    position: sticky;
    top: 18px;
    min-height: 460px;
    align-self: start;
    background: linear-gradient(160deg, #102033, #0d1729);
    color: #fff;
  }

  .result-card .eyebrow {
    color: #8cd7ff;
  }

  .price {
    margin: 10px 0 10px;
    color: var(--green);
    font-size: clamp(3.5rem, 9vw, 6rem);
    font-weight: 950;
    line-height: 0.9;
    letter-spacing: -0.08em;
  }

  .result-summary,
  .empty-state p {
    color: #b7c2d4;
    line-height: 1.55;
  }

  dl {
    display: grid;
    gap: 10px;
    margin: 24px 0;
  }

  dl div {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    padding-bottom: 10px;
  }

  dt {
    color: #8ea0b8;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  dd {
    margin: 0;
    font-weight: 900;
    text-align: right;
  }

  .callout,
  .error-box {
    border-radius: 16px;
    padding: 14px 16px;
    font-weight: 850;
  }

  .callout {
    margin-bottom: 16px;
    background: rgba(255, 106, 26, 0.16);
    color: #ffd0bd;
  }

  .error-box {
    background: #fff1f0;
    color: #9f1d1d;
  }

  .empty-state {
    display: grid;
    min-height: 330px;
    place-content: center;
    text-align: center;
  }

  .empty-icon {
    display: grid;
    width: 82px;
    height: 82px;
    place-items: center;
    margin: 0 auto 18px;
    border-radius: 28px;
    background: linear-gradient(135deg, var(--green), var(--blue));
    color: #102033;
    font-size: 1.8rem;
    font-weight: 950;
  }

  @media (max-width: 860px) {
    .hero-card,
    .calculator-grid {
      grid-template-columns: 1fr;
    }

    .hero-card {
      align-items: flex-start;
      flex-direction: column;
    }

    .result-card {
      position: static;
    }
  }

  @media (max-width: 620px) {
    .pos-shell {
      width: min(100vw - 18px, 1180px);
      padding: 9px 0;
    }

    .hero-card,
    .entry-card,
    .result-card {
      border-radius: 22px;
      padding: 20px;
    }

    .field-row,
    .field-row.three,
    .field-row.load-row,
    .quick-buttons {
      grid-template-columns: 1fr;
    }
  }
`;
