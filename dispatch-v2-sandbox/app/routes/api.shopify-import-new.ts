import { runShopifyImportEndpoint } from "../lib/shopify-import-endpoint.server";

export function loader({ request }: { request: Request }) {
  return runShopifyImportEndpoint(request, "new");
}

export function action({ request }: { request: Request }) {
  return runShopifyImportEndpoint(request, "new");
}
