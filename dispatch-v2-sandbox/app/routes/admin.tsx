import { Form, data, useActionData, useLoaderData, useNavigation } from "react-router";
import { PermissionNav } from "../components/PermissionNav";
import {
  getOriginAddresses,
  getShippingMaterialRules,
  saveOriginAddress,
  saveShippingMaterialRule,
} from "../lib/admin-data.server";
import { requireDispatchUser } from "../lib/auth.server";

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "settings");

  const [origins, rules] = await Promise.all([
    getOriginAddresses(),
    getShippingMaterialRules(),
  ]);

  return data({ origins, rules });
}

export async function action({ request }: { request: Request }) {
  await requireDispatchUser(request, "settings");

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

      return data({ ok: true, message: "Pickup vendor saved." });
    }

    if (intent === "save-rule") {
      await saveShippingMaterialRule({
        prefix: String(form.get("prefix") || "").trim(),
        material_name: String(form.get("material_name") || "").trim(),
        truck_capacity: Number(form.get("truck_capacity") || 22),
        vendor_source: String(form.get("vendor_source") || "").trim(),
        delivery_mode: String(form.get("delivery_mode") || "bulk").trim(),
        capacity_unit: String(form.get("capacity_unit") || "quantity").trim(),
        is_active: form.get("is_active") === "on",
        sort_order: Number(form.get("sort_order") || 0),
      });

      return data({ ok: true, message: "Material rule saved." });
    }

    return data({ ok: false, message: "Unknown admin action." }, { status: 400 });
  } catch (error) {
    console.error("[DISPATCH ADMIN ACTION ERROR]", error);
    return data(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}

function TextInput({
  label,
  name,
  defaultValue = "",
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input type={type} name={name} defaultValue={defaultValue ?? ""} />
    </label>
  );
}

export default function DispatchAdmin() {
  const { origins, rules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  return (
    <main className="page">
      <header className="heroHeader">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Delivery Admin</h1>
          <p>Manage pickup vendors and SKU prefix rules for quote delivery calculations.</p>
        </div>
        <PermissionNav />
      </header>

      {actionData?.message ? (
        <section className={actionData.ok ? "notice successNotice" : "notice errorNotice"}>
          {actionData.message}
        </section>
      ) : null}

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Origins</p>
            <h2>Pickup Vendors</h2>
          </div>
        </div>

        <div className="settingsGrid compactSettingsGrid">
          {origins.map((origin) => (
            <Form key={origin.id || origin.label} method="post" className="settingsPanel settingsForm">
              <input type="hidden" name="intent" value="save-origin" />
              <input type="hidden" name="id" value={origin.id || ""} />
              <TextInput label="Vendor label" name="label" defaultValue={origin.label} />
              <TextInput label="Pickup address" name="address" defaultValue={origin.address} />
              <label className="inlineCheck">
                <input type="checkbox" name="is_active" defaultChecked={origin.is_active} />
                Active
              </label>
              <button type="submit" className="primaryButton" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Vendor"}
              </button>
            </Form>
          ))}

          <Form method="post" className="settingsPanel settingsForm dashedPanel">
            <input type="hidden" name="intent" value="save-origin" />
            <TextInput label="New vendor label" name="label" />
            <TextInput label="New pickup address" name="address" />
            <label className="inlineCheck">
              <input type="checkbox" name="is_active" defaultChecked />
              Active
            </label>
            <button type="submit" className="primaryButton" disabled={isSaving}>
              {isSaving ? "Saving..." : "Add Vendor"}
            </button>
          </Form>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Rules</p>
            <h2>SKU Prefix Rules</h2>
          </div>
        </div>

        <div className="settingsGrid">
          {rules.map((rule) => (
            <Form key={rule.prefix} method="post" className="settingsPanel settingsForm">
              <input type="hidden" name="intent" value="save-rule" />
              <div className="settingsForm threeColumn">
                <TextInput label="Prefix" name="prefix" defaultValue={rule.prefix} />
                <TextInput label="Material name" name="material_name" defaultValue={rule.material_name} />
                <TextInput
                  label="Truck cap"
                  name="truck_capacity"
                  type="number"
                  defaultValue={rule.truck_capacity}
                />
                <label>
                  <span>Cap unit</span>
                  <select name="capacity_unit" defaultValue={rule.capacity_unit || "quantity"}>
                    <option value="quantity">Qty / pallets</option>
                    <option value="weight_lb">Weight (lb)</option>
                  </select>
                </label>
                <label>
                  <span>Delivery type</span>
                  <select name="delivery_mode" defaultValue={rule.delivery_mode || "bulk"}>
                    <option value="bulk">Bulk material</option>
                    <option value="paver">Paver / pallet</option>
                  </select>
                </label>
                <TextInput label="Vendor source" name="vendor_source" defaultValue={rule.vendor_source || ""} />
                <TextInput label="Sort order" name="sort_order" type="number" defaultValue={rule.sort_order} />
              </div>
              <label className="inlineCheck">
                <input type="checkbox" name="is_active" defaultChecked={rule.is_active} />
                Active
              </label>
              <button type="submit" className="primaryButton" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Rule"}
              </button>
            </Form>
          ))}

          <Form method="post" className="settingsPanel settingsForm dashedPanel">
            <input type="hidden" name="intent" value="save-rule" />
            <div className="settingsForm threeColumn">
              <TextInput label="Prefix" name="prefix" />
              <TextInput label="Material name" name="material_name" />
              <TextInput label="Truck cap" name="truck_capacity" type="number" defaultValue={22} />
              <label>
                <span>Cap unit</span>
                <select name="capacity_unit" defaultValue="quantity">
                  <option value="quantity">Qty / pallets</option>
                  <option value="weight_lb">Weight (lb)</option>
                </select>
              </label>
              <label>
                <span>Delivery type</span>
                <select name="delivery_mode" defaultValue="bulk">
                  <option value="bulk">Bulk material</option>
                  <option value="paver">Paver / pallet</option>
                </select>
              </label>
              <TextInput label="Vendor source" name="vendor_source" />
              <TextInput label="Sort order" name="sort_order" type="number" defaultValue={0} />
            </div>
            <label className="inlineCheck">
              <input type="checkbox" name="is_active" defaultChecked />
              Active
            </label>
            <button type="submit" className="primaryButton" disabled={isSaving}>
              {isSaving ? "Saving..." : "Add Rule"}
            </button>
          </Form>
        </div>
      </section>
    </main>
  );
}
