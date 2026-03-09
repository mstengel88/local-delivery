import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { registerCarrierService } from "../lib/register-carrier.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  // Keep this if you want the carrier to self-heal when the app opens
  await registerCarrierService(admin);

  return null;
}

export default function AppIndex() {
  return (
    <div style={{ padding: 30 }}>
      <h1>Local Delivery</h1>
      <p>Your shipping app is running.</p>
    </div>
  );
}
