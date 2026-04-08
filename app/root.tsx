import { Outlet } from "react-router";
import { addDocumentResponseHeaders } from "./shopify.server";

export const headers = addDocumentResponseHeaders;

export default function App() {
  return <Outlet />;
}