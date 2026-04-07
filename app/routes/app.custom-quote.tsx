import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { getQuote } from "../lib/quote-engine.server";

type ProductOption = {
  title: string;
  sku: string;
  vendor: string;
};

const LINE_COUNT = 6;

async function getProductOptions(admin: any): Promise<ProductOption[]> {
  const response = await admin.graphql(`
    query AdminQuoteProducts {
      products(first: 100, sortKey: TITLE) {
        nodes {
          title
          vendor
          variants(first: 50) {
            nodes {
              sku
              title
            }
          }
        }
      }
    }
  `);

  const json = await response.json();
  const products = json?.data?.products?.nodes || [];

  const options: ProductOption[] = [];

  for (const product of products) {
    const vendor = product?.vendor || "";
    const productTitle = product?.title || "";

    for (const variant of product?.variants?.nodes || []) {
      const sku = (variant?.sku || "").trim();
      if (!sku) continue;

      const variantTitle = (variant?.title || "").trim();
      const title =
        variantTitle && variantTitle !== "Default Title"
          ? `${productTitle} - ${variantTitle}`
          : productTitle;

      options.push({
        title,
        sku,
        vendor,
      });
    }
  }

  return options.sort((a, b) => a.title.localeCompare(b.title));
}

export async function loader({ request }: any) {
  const { admin, session } = await authenticate.admin(request);
  const products = await getProductOptions(admin);

  return data({
    shop: session.shop,
    products,
    lineCount: LINE_COUNT,
  });
}

export async function action({ request }: any) {
  const { admin, session } = await authenticate.admin(request);
  const products = await getProductOptions(admin);
  const form = await request.formData();

  const address1 = String(form.get("address1") || "");
  const address2 = String(form.get("address2") || "");
  const city = String(form.get("city") || "");
  const province = String(form.get("province") || "");
  const postalCode = String(form.get("postalCode") || "");
  const country = String(form.get("country") || "US");

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

  for (let i = 0; i < LINE_COUNT; i++) {
    const sku = String(form.get(`sku_${i}`) || "").trim();
    const quantity = Number(form.get(`quantity_${i}`) || 0);

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
        ok: false,
        message: "Add at least one product line with a quantity greater than 0.",
        selectedLines,
        address: {
          address1,
          address2,
          city,
          province,
          postalCode,
          country,
        },
      },
      { status: 400 },
    );
  }

  if (!address1 || !city || !province || !postalCode) {
    return data(
      {
        ok: false,
        message: "Address 1, city, state, and ZIP are required.",
        selectedLines,
        address: {
          address1,
          address2,
          city,
          province,
          postalCode,
          country,
        },
      },
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

  return data({
    ok: true,
    quote,
    selectedLines,
    address: {
      address1,
      address2,
      city,
      province,
      postalCode,
      country,
    },
  });
}

export default function CustomQuotePage() {
  const { products, lineCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();

  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{ padding: 30, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Custom Quote Tool</h1>
      <p style={{ marginBottom: 24 }}>
        Build a multi-line quote using the same delivery logic as checkout.
      </p>

      <Form method="post" style={{ display: "grid", gap: 20 }}>
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            padding: 20,
            display: "grid",
            gap: 14,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20 }}>Delivery Address</h2>

          <label>
            Address 1
            <br />
            <input
              type="text"
              name="address1"
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(320px, 1fr) 140px",
              gap: 12,
              fontWeight: 600,
            }}
          >
            <div>Product</div>
            <div>Quantity</div>
          </div>

          {Array.from({ length: lineCount }).map((_, i) => {
            const selectedLine = actionData?.selectedLines?.[i];
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(320px, 1fr) 140px",
                  gap: 12,
                }}
              >
                <select
                  name={`sku_${i}`}
                  defaultValue={selectedLine?.sku || ""}
                  style={{ width: "100%" }}
                >
                  <option value="">Select product</option>
                  {products.map((product: ProductOption) => (
                    <option key={product.sku} value={product.sku}>
                      {product.title} ({product.sku}) — {product.vendor}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  name={`quantity_${i}`}
                  min="0"
                  step="1"
                  defaultValue={selectedLine?.quantity || ""}
                  style={{ width: "100%" }}
                />
              </div>
            );
          })}
        </div>

        <button
          type="submit"
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

      {actionData?.quote ? (
        <div
          style={{
            marginTop: 24,
            display: "grid",
            gap: 18,
          }}
        >
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 20,
              display: "grid",
              gap: 10,
            }}
          >
            <h2 style={{ margin: 0 }}>Quote Result</h2>
            <div><strong>Service:</strong> {actionData.quote.serviceName}</div>
            <div><strong>Price:</strong> ${(actionData.quote.cents / 100).toFixed(2)}</div>
            <div><strong>Description:</strong> {actionData.quote.description}</div>
            <div><strong>ETA:</strong> {actionData.quote.eta}</div>
            <div><strong>Summary:</strong> {actionData.quote.summary}</div>
            <div>
              <strong>Outside Delivery Area:</strong>{" "}
              {actionData.quote.outsideDeliveryArea ? "Yes" : "No"}
            </div>
            {actionData.quote.outsideDeliveryMiles ? (
              <div>
                <strong>Distance:</strong> {actionData.quote.outsideDeliveryMiles} miles
              </div>
            ) : null}
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
            <h2 style={{ margin: 0 }}>Included Products</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(260px, 1fr) 140px 180px",
                gap: 12,
                fontWeight: 600,
              }}
            >
              <div>Product</div>
              <div>Quantity</div>
              <div>Vendor</div>
            </div>

            {actionData.selectedLines.map((line: any, index: number) => (
              <div
                key={`${line.sku}-${index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(260px, 1fr) 140px 180px",
                  gap: 12,
                }}
              >
                <div>
                  {line.title} ({line.sku})
                </div>
                <div>{line.quantity}</div>
                <div>{line.vendor}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}