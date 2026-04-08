import type { HeadersFunction } from "react-router";
import { Outlet } from "react-router";
import { addDocumentResponseHeaders } from "./shopify.server";

export const headers: HeadersFunction = (headersArgs) => {
  return addDocumentResponseHeaders(headersArgs);
};

export default function App() {
  return <Outlet />;
}