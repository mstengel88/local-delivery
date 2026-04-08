import { redirect } from "react-router";

export async function loader({ request }: any) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    return redirect(`/app?shop=${encodeURIComponent(shop)}`);
  }

  return redirect("/app");
}

export default function Index() {
  return null;
}