import { data } from "react-router";
import { getCustomQuoteById } from "../lib/custom-quotes.server";
import { getProductOptionsFromSupabase } from "../lib/quote-products.server";
import shopify, { authenticate } from "../shopify.server";

const SHOPIFY_TITLE_LIMIT = 40;

function getStoreHandle(shop: string) {
  return shop.replace(".myshopify.com", "");
}

function truncateShopifyTitle(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Quoted Item";
  if (normalized.length <= SHOPIFY_TITLE_LIMIT) return normalized;
  return `${normalized.slice(0, SHOPIFY_TITLE_LIMIT - 1).trimEnd()}…`;
}

function buildQuoteTag(quoteId: string) {
  const normalized = String(quoteId || "").trim();
  if (!normalized) return "quote";
  return `quote:${normalized.slice(0, 34)}`;
}

function splitCustomerName(name: string | null | undefined) {
  const normalized = String(name || "").trim();
  if (!normalized) return { firstName: undefined, lastName: undefined };

  const parts = normalized.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: undefined };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1),
  };
}

async function findOrCreateCustomerId(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  input: {
    email?: string | null;
    firstName?: string;
    lastName?: string;
  },
) {
  const email = String(input.email || "").trim();
  if (!email) return null;

  const findResponse = await admin.graphql(
    `#graphql
      query FindCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          nodes {
            id
          }
        }
      }
    `,
    { variables: { query: `email:${email}` } },
  );
  const findJson = await findResponse.json();
  const existingCustomerId = findJson?.data?.customers?.nodes?.[0]?.id;
  if (existingCustomerId) return existingCustomerId;

  const createResponse = await admin.graphql(
    `#graphql
      mutation CreateQuoteCustomer($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        input: {
          email,
          firstName: input.firstName || undefined,
          lastName: input.lastName || undefined,
        },
      },
    },
  );
  const createJson = await createResponse.json();
  const userErrors = createJson?.data?.customerCreate?.userErrors || [];

  if (userErrors.length > 0) {
    throw new Error(
      userErrors
        .map((error: { field?: string[]; message: string }) =>
          error.field?.length
            ? `${error.field.join(".")}: ${error.message}`
            : error.message,
        )
        .join(", "),
    );
  }

  return createJson?.data?.customerCreate?.customer?.id || null;
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const quoteId = String(form.get("quoteId") || "").trim();

  if (!quoteId) {
    return data({ ok: false, message: "Missing quote id." }, { status: 400 });
  }

  const quote = await getCustomQuoteById(quoteId);
  if (!quote) {
    return data({ ok: false, message: "Quote not found." }, { status: 404 });
  }

  const isEmbeddedRequest = new URL(request.url).pathname.startsWith("/app/");
  const shop = quote.shop || process.env.SHOPIFY_STORE_DOMAIN || "";

  if (!shop) {
    return data(
      { ok: false, message: "Quote is missing a Shopify shop domain." },
      { status: 400 },
    );
  }

  const adminClient = isEmbeddedRequest
    ? await authenticate.admin(request)
    : await shopify.unauthenticated.admin(shop);
  const admin = adminClient.admin;

  const products = await getProductOptionsFromSupabase();
  const lineItems = quote.line_items || [];
  const customerName = splitCustomerName(quote.customer_name);
  let customerId: string | null = null;

  if (lineItems.length === 0) {
    return data({ ok: false, message: "Quote has no line items." }, { status: 400 });
  }

  const productsSubtotalCents = lineItems.reduce(
    (sum, line) =>
      sum + Math.round(Number(line.price || 0) * 100) * Number(line.quantity || 0),
    0,
  );
  const remainingChargeCents = Math.max(
    0,
    Number(quote.quote_total_cents || 0) - productsSubtotalCents,
  );

  const draftLineItems = lineItems.map((line) => {
    const variantId =
      line.variantId ||
      products.find((product) => product.sku === line.sku)?.variantId ||
      null;

    if (variantId) {
      return {
        variantId,
        quantity: Number(line.quantity || 0),
        customAttributes: [
          { key: "Quote ID", value: quote.id },
          { key: "Quoted Unit Price", value: Number(line.price || 0).toFixed(2) },
        ],
      };
    }

    return {
      title: truncateShopifyTitle(line.title),
      sku: line.sku,
      quantity: Number(line.quantity || 0),
      requiresShipping: true,
      taxable: false,
      originalUnitPriceWithCurrency: {
        amount: Number(line.price || 0).toFixed(2),
        currencyCode: "USD",
      },
      customAttributes: [{ key: "Quote ID", value: quote.id }],
    };
  });

  try {
    customerId = await findOrCreateCustomerId(admin, {
      email: quote.customer_email,
      firstName: customerName.firstName,
      lastName: customerName.lastName,
    });
  } catch (error: any) {
    return data(
      {
        ok: false,
        message:
          error?.message ||
          "Could not attach a Shopify customer to this draft order.",
      },
      { status: 400 },
    );
  }

  const response = await admin.graphql(
    `#graphql
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            legacyResourceId
            invoiceUrl
            name
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        input: {
          note: [
            `Quote ID: ${quote.id}`,
            quote.summary ? `Summary: ${quote.summary}` : null,
            quote.description ? `Notes: ${quote.description}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          email: quote.customer_email || undefined,
          customerId: customerId || undefined,
          tags: ["custom-quote", buildQuoteTag(quote.id)],
          shippingAddress: {
            firstName: customerName.firstName,
            lastName: customerName.lastName,
            address1: quote.address1,
            address2: quote.address2 || undefined,
            city: quote.city,
            province: quote.province,
            country: quote.country,
            zip: quote.postal_code,
            phone: quote.customer_phone || undefined,
          },
          billingAddress: {
            firstName: customerName.firstName,
            lastName: customerName.lastName,
            address1: quote.address1,
            address2: quote.address2 || undefined,
            city: quote.city,
            province: quote.province,
            country: quote.country,
            zip: quote.postal_code,
            phone: quote.customer_phone || undefined,
          },
          lineItems: draftLineItems,
          ...(remainingChargeCents > 0
            ? {
                shippingLine: {
                  title: truncateShopifyTitle(
                    quote.service_name || "Quoted Delivery / Tax",
                  ),
                  priceWithCurrency: {
                    amount: (remainingChargeCents / 100).toFixed(2),
                    currencyCode: "USD",
                  },
                },
              }
            : {}),
        },
      },
    },
  );

  const json = await response.json();
  const payload = json?.data?.draftOrderCreate;
  const userErrors = payload?.userErrors || [];

  if (userErrors.length > 0) {
    return data(
      {
        ok: false,
        message: userErrors
          .map((error: { field?: string[]; message: string }) =>
            error.field?.length
              ? `${error.field.join(".")}: ${error.message}`
              : error.message,
          )
          .join(", "),
      },
      { status: 400 },
    );
  }

  const draftOrder = payload?.draftOrder;
  if (!draftOrder?.id) {
    return data(
      { ok: false, message: "Draft order was not created." },
      { status: 500 },
    );
  }

  return data({
    ok: true,
    message: `Draft order ${draftOrder.name} created in Shopify.`,
    draftOrderId: draftOrder.id,
    draftOrderName: draftOrder.name,
    draftOrderInvoiceUrl: draftOrder.invoiceUrl || null,
    draftOrderAdminUrl: draftOrder.legacyResourceId
      ? `https://admin.shopify.com/store/${getStoreHandle(shop)}/draft_orders/${draftOrder.legacyResourceId}`
      : null,
  });
}
