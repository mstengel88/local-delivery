import { Outlet } from "react-router";
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
  return <Outlet />;
}