import type { HeadersFunction } from "react-router";
import { Outlet } from "react-router";
import { addDocumentResponseHeaders } from "./shopify.server";


export default function App() {
  return <Outlet />;
}