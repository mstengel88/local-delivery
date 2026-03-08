import { data, type LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { registerCarrierService } from "../lib/register-carrier.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const result = await registerCarrierService(admin);
  return data({ result });
}

export default function AppIndex() {
  const { result } = useLoaderData() as any;

  return (
    <div style={{ padding: 30, maxWidth: 900 }}>
      <h1>Carrier Registration</h1>
      <div><strong>Status:</strong> {String(result?.ok)}</div>
      <div><strong>Step:</strong> {result?.step}</div>
      <div><strong>Message:</strong> {result?.message}</div>
      <div><strong>Callback URL:</strong> {result?.callbackUrl}</div>

      <pre style={{ marginTop: 20, whiteSpace: "pre-wrap" }}>
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}