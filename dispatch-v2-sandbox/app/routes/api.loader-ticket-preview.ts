import { createHmac } from "node:crypto";
import { redirect } from "react-router";
import { requireDispatchUser } from "../lib/auth.server";

const DEFAULT_GHOS_TICKET_PREVIEW_URL =
  "https://ghos.ghstickets.com/ticketing/preview";
const LINK_LIFETIME_SECONDS = 10 * 60;

function normalize(value: string | null) {
  return String(value || "").trim().replace(/^#+/, "");
}

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request);

  const requestUrl = new URL(request.url);
  const po = normalize(
    requestUrl.searchParams.get("po") ||
      requestUrl.searchParams.get("poNumber") ||
      requestUrl.searchParams.get("order"),
  );
  const dispatchOrderId = normalize(
    requestUrl.searchParams.get("dispatchOrderId"),
  );

  if (!po && !dispatchOrderId) {
    return new Response("A PO number or dispatch order ID is required.", {
      status: 400,
    });
  }

  const integrationSecret = String(process.env.GHOS_INTEGRATION_SECRET || "").trim();
  if (!integrationSecret) {
    return new Response("The GHOS ticket preview is not configured.", {
      status: 503,
    });
  }

  const expires = Math.floor(Date.now() / 1000) + LINK_LIFETIME_SECONDS;
  const canonical = `${po}\n${dispatchOrderId}\n${expires}`;
  const signature = createHmac("sha256", integrationSecret)
    .update(canonical, "utf8")
    .digest("hex");
  const destination = new URL(
    process.env.GHOS_TICKET_PREVIEW_URL || DEFAULT_GHOS_TICKET_PREVIEW_URL,
  );

  if (po) destination.searchParams.set("po", po);
  if (dispatchOrderId) {
    destination.searchParams.set("dispatchOrderId", dispatchOrderId);
  }
  destination.searchParams.set("expires", String(expires));
  destination.searchParams.set("signature", signature);

  return redirect(destination.toString());
}
