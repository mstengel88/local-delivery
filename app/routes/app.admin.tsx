import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getOriginAddresses,
  getShippingMaterialRules,
  saveOriginAddress,
  saveShippingMaterialRule,
} from "../lib/admin-data.server";

export async function loader({ request }: any) {
  await authenticate.admin(request);

  const [origins, rules] = await Promise.all([
    getOriginAddresses(),
    getShippingMaterialRules(),
  ]);

  return data({ origins, rules });
}

export async function action({ request }: any) {
  await authenticate.admin(request);

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  try {
    if (intent === "save-origin") {
      await saveOriginAddress({
        id: String(form.get("id") || "") || undefined,
        label: String(form.get("label") || "").trim(),
        address: String(form.get("address") || "").trim(),
        is_active: form.get("is_active") === "on",
      });

      return data({
        ok: true,
        message: "Pickup vendor saved.",
      });
    }

    if (intent === "save-rule") {
      await saveShippingMaterialRule({
        prefix: String(form.get("prefix") || "").trim(),
        material_name: String(form.get("material_name") || "").trim(),
        truck_capacity: Number(form.get("truck_capacity") || 22),
        vendor_source: String(form.get("vendor_source") || "").trim(),
        is_active: form.get("is_active") === "on",
        sort_order: Number(form.get("sort_order") || 0),
      });

      return data({
        ok: true,
        message: "Material rule saved.",
      });
    }

    return data(
      {
        ok: false,
        message: "Unknown action.",
      },
      { status: 400 },
    );
  } catch (error: any) {
    console.error("[ADMIN ACTION ERROR]", error);

    return data(
      {
        ok: false,
        message: error?.message || "Save failed.",
      },
      { status: 500 },
    );
  }
}

export default function AdminPage() {
  const { origins, rules } = useLoaderData() as any;
  const actionData = useActionData() as any;
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  return (
    <div style={{ padding: 30, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Delivery Admin</h1>
      <p style={{ marginBottom: 24 }}>
        Manage pickup vendors and SKU prefix rules.
      </p>

      {actionData?.message ? (
        <div
          style={{
            marginBottom: 20,
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid",
            borderColor: actionData.ok ? "#16a34a" : "#dc2626",
            background: actionData.ok ? "#f0fdf4" : "#fef2f2",
          }}
        >
          {actionData.message}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 32 }}>
        <section>
          <h2 style={{ fontSize: 22, marginBottom: 12 }}>Pickup Vendors</h2>

          <div style={{ display: "grid", gap: 14 }}>
            {origins.map((origin: any) => (
              <Form
                key={origin.id || origin.label}
                method="post"
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: 16,
                  display: "grid",
                  gap: 12,
                }}
              >
                <input type="hidden" name="intent" value="save-origin" />
                <input type="hidden" name="id" value={origin.id || ""} />

                <label>
                  Vendor label
                  <br />
                  <input
                    type="text"
                    name="label"
                    defaultValue={origin.label}
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </label>

                <label>
                  Pickup address
                  <br />
                  <input
                    type="text"
                    name="address"
                    defaultValue={origin.address}
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </label>

                <label>
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={origin.is_active}
                  />{" "}
                  Active
                </label>

                <button
                  type="submit"
                  disabled={isSaving}
                  style={{
                    width: 160,
                    padding: "10px 14px",
                    background: "#111",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                  }}
                >
                  {isSaving ? "Saving..." : "Save Vendor"}
                </button>
              </Form>
            ))}

            <Form
              method="post"
              style={{
                border: "1px dashed #cbd5e1",
                borderRadius: 10,
                padding: 16,
                display: "grid",
                gap: 12,
              }}
            >
              <input type="hidden" name="intent" value="save-origin" />

              <label>
                New vendor label
                <br />
                <input type="text" name="label" style={{ width: "100%", marginTop: 6 }} />
              </label>

              <label>
                New pickup address
                <br />
                <input type="text" name="address" style={{ width: "100%", marginTop: 6 }} />
              </label>

              <label>
                <input type="checkbox" name="is_active" defaultChecked /> Active
              </label>

              <button
                type="submit"
                disabled={isSaving}
                style={{
                  width: 180,
                  padding: "10px 14px",
                  background: "#111",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                }}
              >
                {isSaving ? "Saving..." : "Add Vendor"}
              </button>
            </Form>
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 22, marginBottom: 12 }}>SKU Prefix Rules</h2>

          <div style={{ display: "grid", gap: 14 }}>
            {rules.map((rule: any) => (
              <Form
                key={rule.prefix}
                method="post"
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: 16,
                  display: "grid",
                  gap: 12,
                }}
              >
                <input type="hidden" name="intent" value="save-rule" />

                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 160px 1fr 120px", gap: 12 }}>
                  <label>
                    Prefix
                    <br />
                    <input
                      type="text"
                      name="prefix"
                      defaultValue={rule.prefix}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </label>

                  <label>
                    Material name
                    <br />
                    <input
                      type="text"
                      name="material_name"
                      defaultValue={rule.material_name}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </label>

                  <label>
                    Truck cap
                    <br />
                    <input
                      type="number"
                      name="truck_capacity"
                      defaultValue={rule.truck_capacity}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </label>

                  <label>
                    Vendor source
                    <br />
                    <input
                      type="text"
                      name="vendor_source"
                      defaultValue={rule.vendor_source || ""}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </label>

                  <label>
                    Sort order
                    <br />
                    <input
                      type="number"
                      name="sort_order"
                      defaultValue={rule.sort_order}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </label>
                </div>

                <label>
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={rule.is_active}
                  />{" "}
                  Active
                </label>

                <button
                  type="submit"
                  disabled={isSaving}
                  style={{
                    width: 160,
                    padding: "10px 14px",
                    background: "#111",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                  }}
                >
                  {isSaving ? "Saving..." : "Save Rule"}
                </button>
              </Form>
            ))}

            <Form
              method="post"
              style={{
                border: "1px dashed #cbd5e1",
                borderRadius: 10,
                padding: 16,
                display: "grid",
                gap: 12,
              }}
            >
              <input type="hidden" name="intent" value="save-rule" />

              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 160px 1fr 120px", gap: 12 }}>
                <label>
                  Prefix
                  <br />
                  <input type="text" name="prefix" style={{ width: "100%", marginTop: 6 }} />
                </label>

                <label>
                  Material name
                  <br />
                  <input type="text" name="material_name" style={{ width: "100%", marginTop: 6 }} />
                </label>

                <label>
                  Truck cap
                  <br />
                  <input type="number" name="truck_capacity" defaultValue={22} style={{ width: "100%", marginTop: 6 }} />
                </label>

                <label>
                  Vendor source
                  <br />
                  <input type="text" name="vendor_source" style={{ width: "100%", marginTop: 6 }} />
                </label>

                <label>
                  Sort order
                  <br />
                  <input type="number" name="sort_order" defaultValue={0} style={{ width: "100%", marginTop: 6 }} />
                </label>
              </div>

              <label>
                <input type="checkbox" name="is_active" defaultChecked /> Active
              </label>

              <button
                type="submit"
                disabled={isSaving}
                style={{
                  width: 180,
                  padding: "10px 14px",
                  background: "#111",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                }}
              >
                {isSaving ? "Saving..." : "Add Rule"}
              </button>
            </Form>
            <form method="post" action="/api/sync-products">
  <button type="submit">Sync Shopify Products</button>
</form>
          </div>
        </section>
      </div>
    </div>
  );
}