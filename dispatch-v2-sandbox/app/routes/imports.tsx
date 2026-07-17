import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  getShopifyImportConfigStatus,
  importRecentShopifyOrders,
  loadDispatchOperationalSettings,
  repairDispatchOrderMaterialsFromProductSourceMap,
  syncShopifyB2BCompanies,
  syncShopifyProductSourceMap,
  type ShopifyImportResult,
  type ShopifyImportMode,
} from "../lib/dispatch.server";
import { requireDispatchEditor, requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "imports");
  const started = performance.now();
  const operations = await loadDispatchOperationalSettings().catch(() => null);
  return data({
    config: getShopifyImportConfigStatus(),
    operations: {
      defaultImportLimit: operations?.defaultImportLimit || 50,
      defaultImportSinceDays: operations?.defaultImportSinceDays || 7,
      calculateDistancesOnImport: operations?.calculateDistancesOnImport ?? true,
      distanceLimit: operations?.distanceLimit || 10,
    },
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

export async function action({ request }: { request: Request }) {
  await requireDispatchUser(request, "imports");
  await requireDispatchEditor(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "import-orders");
  const operations = await loadDispatchOperationalSettings().catch(() => null);
  const limit = Number(form.get("limit") || operations?.defaultImportLimit || 50);
  const sinceDays = Number(form.get("sinceDays") || operations?.defaultImportSinceDays || 7);
  const mode = String(form.get("mode") || "new") as ShopifyImportMode;
  const calculateDistances =
    String(form.get("calculateDistances") || (operations?.calculateDistancesOnImport ? "1" : "0")) === "1";
  const distanceLimit = Number(form.get("distanceLimit") || operations?.distanceLimit || 10);

  try {
    if (intent === "sync-product-source-map") {
      const productLimit = Number(form.get("productLimit") || 500);
      return data(await syncShopifyProductSourceMap(productLimit));
    }

    if (intent === "repair-order-materials") {
      const repairLimit = Number(form.get("repairLimit") || 1000);
      return data(await repairDispatchOrderMaterialsFromProductSourceMap(repairLimit));
    }

    if (intent === "sync-b2b-companies") {
      const companyLimit = Number(form.get("companyLimit") || 250);
      return data(await syncShopifyB2BCompanies(companyLimit));
    }

    const result = await importRecentShopifyOrders({ limit, sinceDays, calculateDistances, distanceLimit, mode });
    return data(result);
  } catch (error) {
    return data(
      {
        ok: false,
        imported: 0,
        updated: 0,
        skipped: 0,
        distanceUpdated: 0,
        distanceSkipped: 0,
        message: error instanceof Error ? error.message : "Shopify import failed.",
        details: [],
      } satisfies ShopifyImportResult,
      { status: 500 },
    );
  }
}

export default function ImportsPage() {
  const { config, operations, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ShopifyImportResult | undefined;
  const navigation = useNavigation();
  const isImporting = navigation.state !== "idle";

  return (
    <main className="page narrowPage">
      <header className="topbar">
        <div>
          <p className="eyebrow">Shopify Intake</p>
          <h1>Import Orders</h1>
          <p className="muted">Pull recent unfulfilled delivery orders into the sandbox dispatch queue.</p>
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

      <section className={config.configured ? "notice" : "notice error"}>
        {config.configured
          ? `Connected config found for ${config.shopDomain} using Admin API ${config.apiVersion} (${config.authMode}).`
          : "Shopify import is not configured yet. Add SHOPIFY_SHOP_DOMAIN plus either SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_API_KEY and SHOPIFY_API_SECRET to .env."}
      </section>

      <section className="panel importPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Automation</p>
            <h2>Cron endpoint</h2>
            <p className="muted">
              Use <code>/api/shopify-import-new?secret=YOUR_SECRET</code> for unattended new-order imports.
              Use <code>/api/shopify-import?secret=YOUR_SECRET&amp;mode=updates</code> only when you want scheduled reconciliation.
            </p>
          </div>
        </div>
      </section>

      {(actionData?.message || isImporting) ? (
        <section className={actionData?.ok === false ? "notice error" : "notice"}>
          {isImporting ? "Importing Shopify orders..." : actionData?.message}
        </section>
      ) : null}

      <section className="panel importPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Manual Sync</p>
            <h2>Run Shopify sync</h2>
            <p className="muted">
              Import New Orders only creates missing dispatch tickets. Update Existing Orders only reconciles tickets already in dispatch.
              Delivered or cancelled dispatch tickets are skipped.
            </p>
          </div>
        </div>

        <Form method="post" className="createFields importFields">
          <label>
            Orders to check
            <select name="limit" defaultValue={String(operations.defaultImportLimit)}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
            </select>
          </label>
          <label>
            Updated within days
            <select name="sinceDays" defaultValue={String(operations.defaultImportSinceDays)}>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </label>
          <label>
            Route times
            <select name="calculateDistances" defaultValue={operations.calculateDistancesOnImport ? "1" : "0"}>
              <option value="1">Calculate after import</option>
              <option value="0">Import only</option>
            </select>
          </label>
          <label>
            Time calc cap
            <select name="distanceLimit" defaultValue={String(operations.distanceLimit)}>
              <option value="5">5 tickets</option>
              <option value="10">10 tickets</option>
              <option value="15">15 tickets</option>
              <option value="25">25 tickets</option>
            </select>
          </label>
          <button
            className="primaryButton"
            type="submit"
            name="mode"
            value="new"
            disabled={!config.configured || isImporting}
          >
            {isImporting ? "Working..." : "Import New Orders"}
          </button>
          <button
            className="secondaryButton"
            type="submit"
            name="mode"
            value="updates"
            disabled={!config.configured || isImporting}
          >
            {isImporting ? "Working..." : "Update Existing Orders"}
          </button>
        </Form>
      </section>

      <section className="panel importPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Product Names</p>
            <h2>Repair SKU product map</h2>
            <p className="muted">
              Sync every Shopify SKU into <code>product_source_map</code> using full product and variant names.
              Run this before updating existing orders when names like Medium, Large, or blend variants are missing.
            </p>
          </div>
        </div>

        <Form method="post" className="createFields importFields">
          <input type="hidden" name="intent" value="sync-product-source-map" />
          <label>
            SKU cap
            <select name="productLimit" defaultValue="500">
              <option value="100">100 SKUs</option>
              <option value="250">250 SKUs</option>
              <option value="500">500 SKUs</option>
              <option value="1000">1000 SKUs</option>
            </select>
          </label>
          <button
            className="secondaryButton"
            type="submit"
            disabled={!config.configured || isImporting}
          >
            {isImporting ? "Working..." : "Sync Product Names"}
          </button>
        </Form>

        <Form method="post" className="createFields importFields">
          <input type="hidden" name="intent" value="repair-order-materials" />
          <label>
            Ticket cap
            <select name="repairLimit" defaultValue="1000">
              <option value="250">250 tickets</option>
              <option value="500">500 tickets</option>
              <option value="1000">1000 tickets</option>
              <option value="2500">2500 tickets</option>
            </select>
          </label>
          <button
            className="primaryButton"
            type="submit"
            disabled={isImporting}
          >
            {isImporting ? "Working..." : "Repair Existing Ticket Names"}
          </button>
        </Form>
      </section>

      <section className="panel importPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">B2B Companies</p>
            <h2>Sync contractor companies</h2>
            <p className="muted">
              Pull Shopify B2B companies, contacts, billing addresses, and tax-exempt status into the quote autocomplete cache.
            </p>
          </div>
        </div>

        <Form method="post" className="createFields importFields">
          <input type="hidden" name="intent" value="sync-b2b-companies" />
          <label>
            Company cap
            <select name="companyLimit" defaultValue="250">
              <option value="100">100 companies</option>
              <option value="250">250 companies</option>
              <option value="500">500 companies</option>
              <option value="1000">1000 companies</option>
            </select>
          </label>
          <button
            className="secondaryButton"
            type="submit"
            disabled={!config.configured || isImporting}
          >
            {isImporting ? "Working..." : "Sync B2B Companies"}
          </button>
        </Form>
      </section>

      {actionData ? (
        <section className="panel importResults">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Last Run</p>
              <h2>
                {actionData.imported} imported · {actionData.updated} updated · {actionData.skipped} skipped
              </h2>
              <p className="muted">
                {actionData.distanceUpdated || 0} route times calculated · {actionData.distanceSkipped || 0} distance skips
              </p>
            </div>
          </div>
          <div className="resultDetails">
            {actionData.details.length ? (
              actionData.details.slice(0, 40).map((detail) => <p key={detail}>{detail}</p>)
            ) : (
              <p className="muted">No skip details recorded.</p>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
