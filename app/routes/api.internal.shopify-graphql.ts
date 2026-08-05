import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import shopify from "../shopify.server";

const SECRET_HEADER = "x-ghs-shopify-gateway-secret";
const MAX_QUERY_LENGTH = 100_000;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function secretsMatch(received: string, expected: string) {
  if (!received || !expected) return false;

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function loader({ request }: LoaderFunctionArgs) {
  return json(
    {
      ok: false,
      message: request.method === "GET" ? "Not found" : "Method not allowed",
    },
    request.method === "GET" ? 404 : 405,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const expectedSecret = process.env.SHOPIFY_GATEWAY_SECRET || "";
  const receivedSecret = request.headers.get(SECRET_HEADER) || "";

  if (!secretsMatch(receivedSecret, expectedSecret)) {
    return json({ ok: false, message: "Unauthorized" }, 401);
  }

  let body: {
    shop?: unknown;
    query?: unknown;
    variables?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Invalid JSON body" }, 400);
  }

  const shop = String(body.shop || "").trim().toLowerCase();
  const allowedShop = String(process.env.SHOPIFY_STORE_DOMAIN || "")
    .trim()
    .toLowerCase();
  const query = typeof body.query === "string" ? body.query : "";
  const variables =
    body.variables && typeof body.variables === "object"
      ? body.variables
      : undefined;

  if (!allowedShop || shop !== allowedShop) {
    return json({ ok: false, message: "Shop is not allowed" }, 403);
  }

  if (!query.trim() || query.length > MAX_QUERY_LENGTH) {
    return json({ ok: false, message: "Invalid GraphQL query" }, 400);
  }

  try {
    const { admin } = await shopify.unauthenticated.admin(shop);
    const response = await admin.graphql(query, { variables });
    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") ||
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[SHOPIFY GATEWAY ERROR]", error);
    return json(
      {
        errors: [
          {
            message:
              error instanceof Error
                ? error.message
                : "Shopify Admin request failed",
          },
        ],
      },
      502,
    );
  }
}
