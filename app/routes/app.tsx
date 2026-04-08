import { Outlet, Link } from "react-router";
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
  return (
    <div>
      <nav
        style={{
          display: "flex",
          gap: "16px",
          padding: "16px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <Link to="/app">Dashboard</Link>
        <Link to="/app/admin">Admin</Link>
        <Link to="/app/custom-quote">Custom Quote</Link>
      </nav>

      <Outlet />
    </div>
  );
}