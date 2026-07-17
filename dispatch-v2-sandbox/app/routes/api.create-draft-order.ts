import { data } from "react-router";
import { hasUserPermission, getCurrentUser } from "../lib/user-auth.server";
import { getCustomQuoteById } from "../lib/custom-quotes.server";
import { getProductOptionsFromSupabase } from "../lib/quote-products.server";
import { normalizeShopDomain, shopifyGraphql } from "../lib/dispatch.server";
import { getConfiguredQuoteTaxRate } from "../lib/quote-tax";
import { supabaseAdmin } from "../lib/supabase.server";

const SHOPIFY_TITLE_LIMIT = 40;

function getStoreHandle(shop: string) {
  return normalizeShopDomain(shop).replace(".myshopify.com", "");
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

function usdMoney(amount: number) {
  return {
    amount: Number(amount || 0).toFixed(2),
    currencyCode: "USD",
  };
}

function parseSavedDeliveryAmountCents(shippingDetails?: string | null) {
  if (!shippingDetails) return null;
  const exactMatch = shippingDetails.match(/=\s*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const fallbackMatch =
    shippingDetails.match(/delivery(?: fee| amount)?:?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i) ||
    shippingDetails.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  const amount = Number(exactMatch?.[1] || fallbackMatch?.[1] || NaN);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function getDeliveryChargeCents({
  quoteTotalCents,
  productsSubtotalCents,
  shippingDetails,
}: {
  quoteTotalCents: number;
  productsSubtotalCents: number;
  shippingDetails?: string | null;
}) {
  const parsedDeliveryCents = parseSavedDeliveryAmountCents(shippingDetails);
  if (parsedDeliveryCents !== null) return Math.max(0, parsedDeliveryCents);

  const taxRate = getConfiguredQuoteTaxRate();
  if (taxRate > 0) {
    const productTaxCents = Math.round(productsSubtotalCents * taxRate);
    return Math.max(0, quoteTotalCents - productsSubtotalCents - productTaxCents);
  }

  return Math.max(0, quoteTotalCents - productsSubtotalCents);
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

function shopifyUserErrorMessage(errors: Array<{ field?: string[]; message?: string }> = []) {
  return errors
    .map((error) => error.field?.length ? `${error.field.join(".")}: ${error.message}` : error.message)
    .filter(Boolean)
    .join(", ");
}

function isB2BDraftInputError(errorMessage: string) {
  return /paymentTerms|payment terms|purchasingEntity|purchasing entity|purchasingCompany|companyLocation|companyContact|companyId/i.test(
    errorMessage,
  );
}

async function findOrCreateCustomerId(input: {
  email?: string | null;
  firstName?: string;
  lastName?: string;
}) {
  const email = String(input.email || "").trim();
  if (!email) return null;

  const findJson = await shopifyGraphql<{
    customers?: { nodes?: Array<{ id?: string | null }> };
  }>(
    `query FindCustomerByEmail($query: String!) {
      customers(first: 1, query: $query) {
        nodes { id }
      }
    }`,
    { query: `email:${email}` },
  );
  const existingCustomerId = findJson.customers?.nodes?.[0]?.id;
  if (existingCustomerId) return existingCustomerId;

  const createJson = await shopifyGraphql<{
    customerCreate?: {
      customer?: { id?: string | null } | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  }>(
    `mutation CreateQuoteCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }`,
    {
      input: {
        email,
        firstName: input.firstName || undefined,
        lastName: input.lastName || undefined,
      },
    },
  );
  const userErrors = createJson.customerCreate?.userErrors || [];
  if (userErrors.length) throw new Error(shopifyUserErrorMessage(userErrors));
  return createJson.customerCreate?.customer?.id || null;
}

async function loadB2BCompanyForQuote(quote: {
  company_name?: string | null;
  shopify_company_id?: string | null;
  shopify_company_location_id?: string | null;
}) {
  const companyId = String(quote.shopify_company_id || "").trim();
  const locationId = String(quote.shopify_company_location_id || "").trim();
  const companyName = String(quote.company_name || "").trim();

  if (!companyId && !locationId && !companyName) return null;

  let query = supabaseAdmin
    .from("dispatch_b2b_companies")
    .select(
      "shopify_company_id,shopify_company_contact_id,shopify_location_id,tax_exempt,payment_terms_template_id",
    )
    .limit(1);

  if (locationId) {
    query = query.eq("shopify_location_id", locationId);
  } else if (companyId) {
    query = query.eq("shopify_company_id", companyId);
  } else {
    query = query.ilike("company_name", companyName);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.warn("[QUOTE B2B LOOKUP WARNING]", error);
    return null;
  }

  return rows?.[0] || null;
}

export async function action({ request }: { request: Request }) {
  if (!(await hasUserPermission(request, "sendToShopify"))) {
    return data({ ok: false, message: "You do not have permission to send quotes to Shopify." }, { status: 403 });
  }

  const form = await request.formData();
  const quoteId = String(form.get("quoteId") || "").trim();
  if (!quoteId) {
    return data({ ok: false, message: "Missing quote id." }, { status: 400 });
  }

  const quote = await getCustomQuoteById(quoteId);
  if (!quote) {
    return data({ ok: false, message: "Quote not found." }, { status: 404 });
  }

  const shop = quote.shop || process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || "";
  if (!shop) {
    return data({ ok: false, message: "Quote is missing a Shopify shop domain." }, { status: 400 });
  }

  const currentUser = await getCurrentUser(request);
  const sentByName =
    currentUser?.name ||
    currentUser?.email ||
    quote.created_by_name ||
    quote.created_by_email ||
    null;
  const products = await getProductOptionsFromSupabase();
  const lineItems = quote.line_items || [];
  const customerName = splitCustomerName(quote.customer_name);
  const billingAddress = {
    address1: quote.billing_address1 || quote.address1,
    address2: quote.billing_address2 || quote.address2 || undefined,
    city: quote.billing_city || quote.city,
    province: quote.billing_province || quote.province,
    country: quote.billing_country || quote.country,
    zip: quote.billing_postal_code || quote.postal_code,
  };
  if (!lineItems.length) {
    return data({ ok: false, message: "Quote has no line items." }, { status: 400 });
  }

  const productsSubtotalCents = lineItems.reduce(
    (sum, line) => sum + Math.round(Number(line.price || 0) * 100) * Number(line.quantity || 0),
    0,
  );
  const deliveryChargeCents = getDeliveryChargeCents({
    quoteTotalCents: Number(quote.quote_total_cents || 0),
    productsSubtotalCents,
    shippingDetails: quote.shipping_details,
  });
  const calculatedTaxCents = Math.max(
    0,
    Number(quote.quote_total_cents || 0) - productsSubtotalCents - deliveryChargeCents,
  );
  const b2bCompany = await loadB2BCompanyForQuote(quote);
  const quoteTaxExempt =
    Boolean(quote.tax_exempt) ||
    Boolean(b2bCompany?.tax_exempt) ||
    calculatedTaxCents <= 1;
  const paymentTermsTemplateId = String(
    quote.payment_terms_template_id || b2bCompany?.payment_terms_template_id || "",
  ).trim();
  const companyId = String(quote.shopify_company_id || b2bCompany?.shopify_company_id || "").trim();
  const companyContactId = String(
    quote.shopify_company_contact_id || b2bCompany?.shopify_company_contact_id || "",
  ).trim();
  const companyLocationId = String(
    quote.shopify_company_location_id || b2bCompany?.shopify_location_id || "",
  ).trim();
  const canUsePurchasingCompany = Boolean(companyId && companyContactId && companyLocationId);

  const draftLineItems = lineItems.map((line) => {
    const variantId =
      line.variantId ||
      products.find((product) => product.sku === line.sku)?.variantId ||
      null;

    if (variantId) {
      return {
        variantId,
        quantity: Number(line.quantity || 0),
        priceOverride: usdMoney(Number(line.price || 0)),
        customAttributes: [
          { key: "Quote ID", value: quote.id },
          { key: "Quoted Unit Price", value: Number(line.price || 0).toFixed(2) },
        ],
        ...(quoteTaxExempt ? { taxable: false } : {}),
      };
    }

    return {
      title: truncateShopifyTitle(line.title),
      sku: line.sku,
      quantity: Number(line.quantity || 0),
      requiresShipping: true,
      taxable: false,
      originalUnitPriceWithCurrency: usdMoney(Number(line.price || 0)),
      customAttributes: [{ key: "Quote ID", value: quote.id }],
    };
  });

  let customerId: string | null = null;
  try {
    customerId = await findOrCreateCustomerId({
      email: quote.customer_email,
      firstName: customerName.firstName,
      lastName: customerName.lastName,
    });
  } catch (error) {
    return data(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not attach a Shopify customer to this draft order.",
      },
      { status: 400 },
    );
  }

  const draftInput = {
    note: [
      `Quote ID: ${quote.id}`,
      sentByName ? `Sent by: ${sentByName}` : null,
      quote.summary ? `Summary: ${quote.summary}` : null,
      quote.description ? `Notes: ${quote.description}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    email: quote.customer_email || undefined,
    ...(!canUsePurchasingCompany && customerId && !quoteTaxExempt ? { customerId } : {}),
    ...(quoteTaxExempt ? { taxExempt: true } : {}),
    tags: ["custom-quote", buildQuoteTag(quote.id)],
    acceptAutomaticDiscounts: false,
    allowDiscountCodesInCheckout: false,
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
      address1: billingAddress.address1,
      address2: billingAddress.address2,
      city: billingAddress.city,
      province: billingAddress.province,
      country: billingAddress.country,
      zip: billingAddress.zip,
      phone: quote.customer_phone || undefined,
    },
    lineItems: draftLineItems,
    ...(canUsePurchasingCompany
      ? {
          purchasingEntity: {
            purchasingCompany: {
              companyId,
              companyContactId,
              companyLocationId,
            },
          },
        }
      : {}),
    ...(paymentTermsTemplateId
      ? {
          paymentTerms: {
            paymentTermsTemplateId,
            paymentSchedules: [
              {
                issuedAt: new Date().toISOString(),
              },
            ],
          },
        }
      : {}),
    ...(deliveryChargeCents > 0
      ? {
          shippingLine: {
            title: truncateShopifyTitle(quote.service_name || "Quoted Delivery"),
            priceWithCurrency: usdMoney(deliveryChargeCents / 100),
          },
        }
      : {}),
  };

  type DraftOrderCreatePayload = {
    draftOrderCreate?: {
      draftOrder?: {
        id?: string | null;
        legacyResourceId?: string | null;
        invoiceUrl?: string | null;
        name?: string | null;
      } | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };

  async function createDraftOrder(input: Record<string, unknown>) {
    return shopifyGraphql<DraftOrderCreatePayload>(
    `mutation draftOrderCreate($input: DraftOrderInput!) {
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
    }`,
      { input },
    );
  }

  let json: DraftOrderCreatePayload;
  let b2bWarning: string | null = null;
  try {
    json = await createDraftOrder(draftInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!paymentTermsTemplateId && !canUsePurchasingCompany || !isB2BDraftInputError(message)) {
      throw error;
    }

    const { paymentTerms, purchasingEntity, ...fallbackInput } = draftInput as Record<string, unknown>;
    json = await createDraftOrder({
      ...fallbackInput,
      ...(customerId && !quoteTaxExempt ? { customerId } : {}),
    });
    b2bWarning = ` Payment terms could not be applied automatically: ${message}`;
  }

  const payload = json.draftOrderCreate;
  const userErrors = payload?.userErrors || [];
  if (userErrors.length) {
    const userErrorMessage = shopifyUserErrorMessage(userErrors);
    if ((paymentTermsTemplateId || canUsePurchasingCompany) && isB2BDraftInputError(userErrorMessage)) {
      const { paymentTerms, purchasingEntity, ...fallbackInput } = draftInput as Record<string, unknown>;
      const fallbackJson = await createDraftOrder({
        ...fallbackInput,
        ...(customerId && !quoteTaxExempt ? { customerId } : {}),
      });
      const fallbackPayload = fallbackJson.draftOrderCreate;
      const fallbackUserErrors = fallbackPayload?.userErrors || [];
      if (fallbackUserErrors.length) {
        return data({ ok: false, message: shopifyUserErrorMessage(fallbackUserErrors) }, { status: 400 });
      }

      const fallbackDraftOrder = fallbackPayload?.draftOrder;
      if (!fallbackDraftOrder?.id) {
        return data({ ok: false, message: "Draft order was not created." }, { status: 500 });
      }

      return data({
        ok: true,
        message: `Draft order ${fallbackDraftOrder.name} created in Shopify. Payment terms could not be applied automatically: ${userErrorMessage}`,
        draftOrderId: fallbackDraftOrder.id,
        draftOrderName: fallbackDraftOrder.name,
        draftOrderInvoiceUrl: fallbackDraftOrder.invoiceUrl || null,
        draftOrderAdminUrl: fallbackDraftOrder.legacyResourceId
          ? `https://admin.shopify.com/store/${getStoreHandle(shop)}/draft_orders/${fallbackDraftOrder.legacyResourceId}`
          : null,
      });
    }

    return data({ ok: false, message: userErrorMessage }, { status: 400 });
  }

  const draftOrder = payload?.draftOrder;
  if (!draftOrder?.id) {
    return data({ ok: false, message: "Draft order was not created." }, { status: 500 });
  }

  return data({
    ok: true,
    message: `Draft order ${draftOrder.name} created in Shopify.${b2bWarning || ""}`,
    draftOrderId: draftOrder.id,
    draftOrderName: draftOrder.name,
    draftOrderInvoiceUrl: draftOrder.invoiceUrl || null,
    draftOrderAdminUrl: draftOrder.legacyResourceId
      ? `https://admin.shopify.com/store/${getStoreHandle(shop)}/draft_orders/${draftOrder.legacyResourceId}`
      : null,
  });
}
