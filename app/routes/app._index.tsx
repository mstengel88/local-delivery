import { Form, useLoaderData } from "react-router";
import {
  data,
  redirect,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";

import { authenticate } from "../shopify.server";
import { registerCarrierService } from "../lib/register-carrier.server";
import { getAppSettings, saveAppSettings } from "../lib/app-settings.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  // Ensure carrier service exists
  const carrierResult = await registerCarrierService(admin);

  // Load admin settings
  const settings = await getAppSettings(session.shop);

  return data({ settings, carrierResult });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const form = await request.formData();

  await saveAppSettings(session.shop, {
    useTestFlatRate: form.get("useTestFlatRate") === "on",
    testFlatRateCents: Number(form.get("testFlatRateCents") || 5000),
    enableCalculatedRates: form.get("enableCalculatedRates") === "on",
    enableRemoteSurcharge: form.get("enableRemoteSurcharge") === "on",
    enableDebugLogging: form.get("enableDebugLogging") === "on",
    showVendorSource: form.get("showVendorSource") === "on",
  });

  return redirect("/app");
}

export default function AppIndex() {
  const { settings, carrierResult } = useLoaderData() as any;

  return (
    <div style={{ padding: 30, maxWidth: 800 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Local Delivery Admin</h1>
      <p style={{ marginBottom: 24 }}>
        Manage shipping behavior for testing and live checkout.
      </p>

      {/* Carrier status panel */}
      <div
        style={{
          marginBottom: 30,
          padding: 14,
          borderRadius: 8,
          border: "1px solid #ddd",
          background: carrierResult?.ok ? "#f6fff6" : "#fff6f6",
        }}
      >
        <div>
          <strong>Carrier status:</strong>{" "}
          {carrierResult?.ok ? "OK" : "Error"}
        </div>

        <div>
          <strong>Step:</strong> {carrierResult?.step}
        </div>

        <div>
          <strong>Message:</strong> {carrierResult?.message}
        </div>
      </div>

      <Form method="post">
        <div style={{ display: "grid", gap: 18 }}>
          <label>
            <input
              type="checkbox"
              name="enableCalculatedRates"
              defaultChecked={settings.enableCalculatedRates}
            />{" "}
            Enable calculated shipping rates
          </label>

          <label>
            <input
              type="checkbox"
              name="useTestFlatRate"
              defaultChecked={settings.useTestFlatRate}
            />{" "}
            Use test flat rate (for checkout testing)
          </label>

          <label>
            Test flat rate (cents)
            <br />
            <input
              type="number"
              name="testFlatRateCents"
              defaultValue={settings.testFlatRateCents}
              min={0}
              style={{ width: 220, marginTop: 5 }}
            />
          </label>

          <label>
            <input
              type="checkbox"
              name="enableRemoteSurcharge"
              defaultChecked={settings.enableRemoteSurcharge}
            />{" "}
            Enable remote ZIP surcharge
          </label>

          <label>
            <input
              type="checkbox"
              name="enableDebugLogging"
              defaultChecked={settings.enableDebugLogging}
            />{" "}
            Enable debug logging
          </label>

          <label>
            <input
              type="checkbox"
              name="showVendorSource"
              defaultChecked={settings.showVendorSource}
            />{" "}
            Show vendor source pulled from product
          </label>

          <button
            type="submit"
            style={{
              marginTop: 10,
              padding: "10px 16px",
              background: "#111",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              width: 180,
            }}
          >
            Save Settings
          </button>
        </div>
      </Form>
    </div>
  );
}
