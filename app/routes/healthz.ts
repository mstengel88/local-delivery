import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json({ ok: false, message: "Method not allowed" }, { status: 405 });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      {
        ok: true,
        service: "local-delivery-shopify-bridge",
        database: "ready",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("[HEALTH CHECK] Database unavailable", error);
    return Response.json(
      {
        ok: false,
        service: "local-delivery-shopify-bridge",
        database: "unavailable",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
