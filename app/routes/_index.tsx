import { redirect } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: any) => {
  const url = new URL(request.url);

  // Preserve shop param if present
  const shop = url.searchParams.get("shop");

  if (shop) {
    return redirect(`/app?shop=${shop}`);
  }

  return redirect("/app");
};

export default function Index() {
  return null;
}