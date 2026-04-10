import { Outlet, Link, useLoaderData, useLocation, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import {
  ensureProductOptionsFresh,
  getLatestProductSyncTimestamp,
} from "../lib/quote-products.server";

export async function loader({ request }: any) {
  const { admin } = await authenticate.admin(request);
  try {
    const syncStatus = await ensureProductOptionsFresh(admin);
    return data({
      lastProductSyncAt: syncStatus.lastUpdatedAt,
      justSynced: syncStatus.synced,
      syncedCount: syncStatus.syncedCount,
    });
  } catch (error) {
    console.error("[AUTO PRODUCT SYNC ERROR]", error);
    return data({
      lastProductSyncAt: await getLatestProductSyncTimestamp(),
      justSynced: false,
      syncedCount: 0,
    });
  }
}

export function ErrorBoundary() {
  return boundary.error(null as any);
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};

export default function AppLayout() {
  const loaderData = useLoaderData<typeof loader>();
  const location = useLocation();
  const qs = location.search || "";
  const lastSyncLabel = loaderData?.lastProductSyncAt
    ? new Date(loaderData.lastProductSyncAt).toLocaleString()
    : "Never";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        color: "#f8fafc",
      }}
    >
      <nav
        style={{
          display: "flex",
          gap: "12px",
          padding: "16px 20px",
          borderBottom: "1px solid #1e293b",
          alignItems: "center",
          flexWrap: "wrap",
          background: "#111827",
        }}
      >
        <Link
          to={`/app${qs}`}
          style={{
            color: "#e5e7eb",
            textDecoration: "none",
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid #334155",
            background: "#0f172a",
          }}
        >
          Dashboard
        </Link>

        <Link
          to={`/app/admin${qs}`}
          style={{
            color: "#e5e7eb",
            textDecoration: "none",
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid #334155",
            background: "#0f172a",
          }}
        >
          Admin
        </Link>

        <Link
          to={`/app/custom-quote${qs}`}
          style={{
            color: "#e5e7eb",
            textDecoration: "none",
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid #334155",
            background: "#0f172a",
          }}
        >
          Custom Quote
        </Link>

        <a
          href="/custom-quote"
          target="_blank"
          rel="noreferrer"
          style={{
            color: "#e5e7eb",
            textDecoration: "none",
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid #334155",
            background: "#0f172a",
          }}
        >
          Quote Portal
        </a>

        <Form
          method="post"
          action={`/api/sync-products${qs}`}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}
        >
          <div
            style={{
              padding: "8px 12px",
              borderRadius: "999px",
              border: "1px solid #334155",
              background: loaderData?.justSynced ? "rgba(22, 163, 74, 0.16)" : "#0f172a",
              color: loaderData?.justSynced ? "#86efac" : "#cbd5e1",
              fontSize: 12,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            {loaderData?.justSynced ? "Auto-synced now" : "Product sync"}
            <span style={{ color: "#94a3b8", marginLeft: 6 }}>
              {lastSyncLabel}
            </span>
          </div>
          <button
            type="submit"
            style={{
              padding: "10px 14px",
              borderRadius: "10px",
              border: "none",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Sync Shopify Products
          </button>
        </Form>
      </nav>

      <div style={{ padding: "20px" }}>
        <Outlet />
      </div>
    </div>
  );
}
