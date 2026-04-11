import { data } from "react-router";
import { deleteCustomQuote, getCustomQuoteById } from "../lib/custom-quotes.server";
import { hasAdminQuoteAccess } from "../lib/admin-quote-auth.server";
import { authenticate } from "../shopify.server";

export async function action({ request }: { request: Request }) {
  const url = new URL(request.url);
  const isEmbeddedRequest = url.pathname.startsWith("/app/");

  if (isEmbeddedRequest) {
    await authenticate.admin(request);
  } else {
    const allowed = await hasAdminQuoteAccess(request);
    if (!allowed) {
      return data({ ok: false, message: "Please log in." }, { status: 401 });
    }
  }

  const form = await request.formData();
  const quoteId = String(form.get("quoteId") || "").trim();

  if (!quoteId) {
    return data({ ok: false, message: "Missing quote id." }, { status: 400 });
  }

  const existing = await getCustomQuoteById(quoteId);
  if (!existing) {
    return data({ ok: false, message: "Quote not found." }, { status: 404 });
  }

  await deleteCustomQuote(quoteId);

  return data({
    ok: true,
    message: "Quote deleted. This action cannot be undone.",
    deletedQuoteId: quoteId,
  });
}
