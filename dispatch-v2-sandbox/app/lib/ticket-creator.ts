export const DEFAULT_TICKET_CREATOR_URL = "/api/loader-ticket-preview";

type TicketOrder = {
  id: string;
  orderNumber?: string | null;
  customer?: string | null;
  contact?: string | null;
  address?: string | null;
  city?: string | null;
  material?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
};

type TicketRoute = {
  code?: string | null;
  truck?: string | null;
  driver?: string | null;
};

function appendIfPresent(params: URLSearchParams, key: string, value: unknown) {
  const normalized = String(value ?? "").trim();
  if (normalized) params.set(key, normalized);
}

export function loaderTicketPo(order: TicketOrder) {
  return String(order.orderNumber || order.id).replace(/^#/, "");
}

export function buildLoaderTicketCreatorUrl(
  baseUrl: string | undefined,
  order: TicketOrder,
  route?: TicketRoute | null,
  loadedQuantity?: string,
  options: { embed?: boolean } = {},
) {
  const target = (baseUrl || DEFAULT_TICKET_CREATOR_URL).trim() || DEFAULT_TICKET_CREATOR_URL;
  const po = loaderTicketPo(order);
  const quantity = loadedQuantity || String(order.quantity ?? "");
  const params = new URLSearchParams();

  appendIfPresent(params, "po", po);
  appendIfPresent(params, "poNumber", po);
  appendIfPresent(params, "order", po);
  appendIfPresent(params, "dispatchOrderId", order.id);
  appendIfPresent(params, "customer", order.customer);
  appendIfPresent(params, "contact", order.contact);
  appendIfPresent(params, "material", order.material);
  appendIfPresent(params, "quantity", quantity);
  appendIfPresent(params, "loadedQuantity", quantity);
  appendIfPresent(params, "unit", order.unit);
  appendIfPresent(params, "route", route?.code);
  appendIfPresent(params, "truck", route?.truck);
  appendIfPresent(params, "driver", route?.driver);
  appendIfPresent(params, "address", order.address);
  appendIfPresent(params, "city", order.city);
  if (options.embed) params.set("embed", "ticket");

  try {
    const url = new URL(target);
    params.forEach((value, key) => url.searchParams.set(key, value));
    return url.toString();
  } catch {
    const separator = target.includes("?") ? "&" : "?";
    return `${target}${separator}${params.toString()}`;
  }
}
