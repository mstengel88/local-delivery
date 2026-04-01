import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";
import { registerCarrierService } from "../lib/register-carrier.server";
import { getAppSettings, saveAppSettings, type AppSettings } from "../lib/app-settings.server";

type ActionData = {
  ok: boolean;
  message: string;
  settings?: AppSettings;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  await registerCarrierService(admin);
  const settings = await getAppSettings(session.shop);

  return data({ settings });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  try {
    const savedSettings = await saveAppSettings(session.shop, {
      useTestFlatRate: form.get("useTestFlatRate") === "on",
      testFlatRateCents: Number(form.get("testFlatRateCents") || 5000),
      enableCalculatedRates: form.get("enableCalculatedRates") === "on",
      enableRemoteSurcharge: form.get("enableRemoteSurcharge") === "on",
      enableDebugLogging: form.get("enableDebugLogging") === "on",
      showVendorSource: form.get("showVendorSource") === "on",
    });

    return data<ActionData>({
      ok: true,
      message: "Settings saved successfully.",
      settings: savedSettings,
    });
  } catch (error: any) {
    console.error("[APP SETTINGS ACTION ERROR]", error);

    return data<ActionData>(
      {
        ok: false,
        message: error?.message || "Failed to save settings.",
      },
      { status: 500 },
    );
  }
}

export default function AppIndex() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const settings = actionData?.settings ?? loaderData.settings;
  const isSaving = navigation.state === "submitting";

  return (
    <div style={{ padding: 30, maxWidth: 800 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Local Delivery Admin</h1>
      <p style={{ marginBottom: 24 }}>
        Manage shipping behavior for testing and live checkout.
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
            color: "#111827",
          }}
        >
          {actionData.message}
        </div>
      ) : null}

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
            Use test flat rate
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
            Show vendor source on checkout
          </label>

          <button
            type="submit"
            disabled={isSaving}
            style={{
              marginTop: 10,
              padding: "10px 16px",
              background: isSaving ? "#6b7280" : "#111",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: isSaving ? "default" : "pointer",
              width: 180,
            }}
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </Form>
    </div>
  );
}