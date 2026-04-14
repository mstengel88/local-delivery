import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { data, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  listProductUnitLabels,
  saveProductUnitLabels,
  type ProductUnitLabelRecord,
} from "../lib/product-unit-labels.server";

type ActionData = {
  ok: boolean;
  message: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const products = await listProductUnitLabels(admin, 250);

  return data({ products });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const updates: Array<{ productId: string; unitLabel: string }> = [];

  formData.forEach((value, key) => {
    if (!key.startsWith("unitLabel::")) return;

    updates.push({
      productId: key.replace("unitLabel::", ""),
      unitLabel: String(value || "").trim(),
    });
  });

  const result = await saveProductUnitLabels(admin, updates);

  if (result.userErrors.length) {
    return data<ActionData>(
      {
        ok: false,
        message: result.userErrors.map((error) => error.message).join(" "),
      },
      { status: 400 },
    );
  }

  return data<ActionData>({
    ok: true,
    message: "Unit labels saved. Your storefront embed will use the updated labels right away.",
  });
}

function ProductRow({ product }: { product: ProductUnitLabelRecord }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "84px minmax(220px, 1.5fr) minmax(180px, 1fr) minmax(170px, 0.8fr)",
        gap: 16,
        alignItems: "center",
        padding: "14px 16px",
        border: "1px solid #1f2937",
        borderRadius: 14,
        background: "#0b1220",
      }}
    >
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #1f2937",
          background: "#111827",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#64748b",
          fontSize: 12,
        }}
      >
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          "No image"
        )}
      </div>

      <div>
        <div style={{ fontWeight: 700, color: "#f8fafc", marginBottom: 6 }}>{product.title}</div>
        <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 6 }}>/{product.handle}</div>
        <div style={{ color: "#cbd5e1", fontSize: 12 }}>
          Status: {product.status}
          {product.onlineStoreUrl ? (
            <>
              {" · "}
              <a
                href={product.onlineStoreUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#93c5fd" }}
              >
                View product
              </a>
            </>
          ) : null}
        </div>
      </div>

      <div>
        <div style={{ color: "#cbd5e1", fontSize: 13, marginBottom: 8 }}>Storefront label</div>
        <input
          type="text"
          name={`unitLabel::${product.id}`}
          defaultValue={product.unitLabel}
          placeholder="per yard"
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid #334155",
            background: "#020617",
            color: "#f8fafc",
            padding: "10px 12px",
          }}
        />
      </div>

      <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
        Examples:
        <div>`per yard`</div>
        <div>`per ton`</div>
        <div>`per gallon`</div>
      </div>
    </div>
  );
}

export default function UnitLabelsPage() {
  const { products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1240 }}>
      <div
        style={{
          padding: 24,
          borderRadius: 18,
          background: "linear-gradient(135deg, #0f172a 0%, #111827 55%, #1d4ed8 160%)",
          border: "1px solid #1e293b",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 30 }}>Unit Labels</h1>
        <p style={{ margin: "10px 0 0", color: "#cbd5e1", maxWidth: 820, lineHeight: 1.6 }}>
          Save a short unit label for each product and the theme app extension will append it to
          visible storefront prices on product pages and collection grids.
        </p>
      </div>

      <div
        style={{
          padding: 20,
          borderRadius: 16,
          border: "1px solid #1f2937",
          background: "#0f172a",
          color: "#cbd5e1",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "#f8fafc" }}>Setup after deploy:</strong>
        <div>1. Deploy the app so Shopify creates the `Price unit label` product metafield.</div>
        <div>2. In Online Store theme editor, enable the `Price unit labels` app embed.</div>
        <div>3. Save labels here like `per yard`, `per ton`, or `per gallon`.</div>
      </div>

      {actionData?.message ? (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 14,
            border: "1px solid",
            borderColor: actionData.ok ? "#16a34a" : "#dc2626",
            background: actionData.ok ? "rgba(22, 163, 74, 0.15)" : "rgba(220, 38, 38, 0.14)",
            color: "#f8fafc",
          }}
        >
          {actionData.message}
        </div>
      ) : null}

      <Form method="post" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="submit"
            disabled={isSaving}
            style={{
              padding: "12px 18px",
              borderRadius: 10,
              border: "none",
              background: isSaving ? "#475569" : "#84cc16",
              color: "#081018",
              fontWeight: 800,
              cursor: isSaving ? "default" : "pointer",
            }}
          >
            {isSaving ? "Saving labels..." : "Save all labels"}
          </button>
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            Showing the first {products.length} products sorted by title.
          </div>
        </div>

        {products.map((product) => (
          <ProductRow key={product.id} product={product} />
        ))}
      </Form>
    </div>
  );
}
