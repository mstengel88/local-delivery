import { redirect } from "react-router";

export async function loader({ request }: any) {
  const url = new URL(request.url);

  // Preserve ALL incoming Shopify params
  const destination = `/app${url.search}`;

  return redirect(destination);
}

export default function Index() {
  return null;
}