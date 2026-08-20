import { data } from "react-router";
import { createDispatchGhosSession } from "../lib/auth.server";

export async function action({ request }: { request: Request }) {
  if (request.method.toUpperCase() !== "POST") {
    return data({ ok: false, message: "Method not allowed." }, { status: 405 });
  }

  let tokenHash = "";
  try {
    const body = await request.json();
    tokenHash = typeof body?.tokenHash === "string" ? body.tokenHash : "";
  } catch {
    return data({ ok: false, message: "Invalid GHOS session request." }, { status: 400 });
  }

  return createDispatchGhosSession({ tokenHash });
}
