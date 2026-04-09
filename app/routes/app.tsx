import { Outlet, Link, useLocation } from "react-router";
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
    <div>
      <nav
        style={{
          display: "flex",
          gap: "16px",
          padding: "16px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <Link to={`/app${qs}`}>Dashboard</Link>
        <Link to={`/app/admin${qs}`}>Admin</Link>
        <Link to={`/app/custom-quote${qs}`}>Custom Quote</Link>
        <a href="/custom-quote" target="_blank" rel="noreferrer">Quote Portal</a>
      </nav>

      <Outlet />
    </div>
  );
}