import { Outlet, Link, useLocation, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: any) {
  await authenticate.admin(request);
  return null;
}

export function ErrorBoundary() {
  return boundary.error(null as any);
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};

export default function AppLayout() {
  const location = useLocation();
  const qs = location.search || "";

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
          style={{ marginLeft: "auto" }}
        >
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