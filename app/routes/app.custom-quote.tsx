import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { getQuote } from "../lib/quote-engine.server";

type ProductOption = {
  title: string;
  sku: string;
  vendor: string;
};

const PRODUCT_OPTIONS: ProductOption[] = [
  { title: "#1 Stone", sku: "100-681", vendor: "Lannon West" },
  { title: "Lawn & Garden Topsoil", sku: "400-134", vendor: "Green Hills Supply" },
  { title: "Field Run", sku: "499-349", vendor: "Liesener" },
];

export async function loader({ request }: any) {
  const { session } = await authenticate.admin(request);

  return data({
    shop: session.shop,
    products: PRODUCT_OPTIONS,
  });
}

export async function action({ request }: any) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const address1 = String(form.get("address1") || "");
  const address2 = String(form.get("address2") || "");
  const city = String(form.get("city") || "");
  const province = String(form.get("province") || "");
  const postalCode = String(form.get("postalCode") || "");
  const country = String(form.get("country") || "US");

  const selectedSku = String(form.get("sku") || "");
  const quantity = Number(form.get("quantity") || 0);

  const product = PRODUCT_OPTIONS.find((p) => p.sku === selectedSku);

  if (!product || quantity <= 0) {
    return data(
      {
        ok: false,
        message: "Please select a product and enter a valid quantity.",
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
    items: [
      {
        sku: product.sku,
        quantity,
        requiresShipping: true,
        pickupVendor: product.vendor,
      },
    ],
  });

  return data({
    ok: true,
    quote,
    selectedProduct: product,
    quantity,
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
  const { products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();

  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{ padding: 30, maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Custom Quote Tool</h1>
      <p style={{ marginBottom: 24 }}>
        Generate manual delivery quotes using the same pricing logic as checkout.
      </p>

      <Form method="post" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 16 }}>
          <label>
            Product
            <br />
            <select name="sku" style={{ width: "100%", marginTop: 6 }}>
              <option value="">Select product</option>
              {products.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {product.title} ({product.sku})
                </option>
              ))}
            </select>
          </label>

          <label>
            Quantity
            <br />
            <input type="number" name="quantity" min="1" style={{ width: "100%", marginTop: 6 }} />
          </label>
        </div>

        <label>
          Address 1
          <br />
          <input type="text" name="address1" style={{ width: "100%", marginTop: 6 }} />
        </label>

        <label>
          Address 2
          <br />
          <input type="text" name="address2" style={{ width: "100%", marginTop: 6 }} />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px 120px", gap: 16 }}>
          <label>
            City
            <br />
            <input type="text" name="city" style={{ width: "100%", marginTop: 6 }} />
          </label>

          <label>
            State
            <br />
            <input type="text" name="province" defaultValue="WI" style={{ width: "100%", marginTop: 6 }} />
          </label>

          <label>
            ZIP
            <br />
            <input type="text" name="postalCode" style={{ width: "100%", marginTop: 6 }} />
          </label>

          <label>
            Country
            <br />
            <input type="text" name="country" defaultValue="US" style={{ width: "100%", marginTop: 6 }} />
          </label>
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
          <div><strong>Outside Delivery Area:</strong> {actionData.quote.outsideDeliveryArea ? "Yes" : "No"}</div>
          {actionData.quote.outsideDeliveryMiles ? (
            <div><strong>Distance:</strong> {actionData.quote.outsideDeliveryMiles} miles</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}