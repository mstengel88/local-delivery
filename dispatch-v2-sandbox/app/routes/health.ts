import { data } from "react-router";
import { loadDispatchHealthStatus } from "../lib/dispatch.server";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const strict = url.searchParams.get("strict") === "1";
  const health = await loadDispatchHealthStatus(strict);

  return data(health, {
    status: health.ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
