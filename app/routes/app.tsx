import { Outlet } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { NavMenu } from "@shopify/shopify-app-react-router/react";


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
    <>
      <NavMenu>
        <a href="/app">Dashboard</a>
        <a href="/app/custom-quote">Custom Quote</a>
      </NavMenu>

      <Outlet />
    </>
  );
}