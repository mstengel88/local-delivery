type QuoteItem = {
  sku?: string;
  quantity: number;
  requiresShipping?: boolean;
  pickupVendor?: string;
  price?: number;
};

type GetQuoteInput = {
  shop: string;
  postalCode: string;
  country: string;
  province: string;
  city: string;
  address1: string;
  address2?: string;
  items: QuoteItem[];
};

type QuoteResult = {
  cents: number;
  serviceName: string;
  serviceCode: string;
  description: string;
  eta: string;
  summary: string;
  outsideDeliveryArea?: boolean;
  outsideDeliveryMiles?: number;
  outsideDeliveryRadius?: number;
  outsideDeliveryPhone?: string;
};

export async function getQuote(input: GetQuoteInput): Promise<QuoteResult> {
  const radiusMiles = Number(process.env.DELIVERY_RADIUS_MILES || "50");
  const baseDeliveryCents = Number(process.env.BASE_DELIVERY_CENTS || "8500");
  const outsideDeliveryPhone =
    process.env.OUTSIDE_DELIVERY_PHONE || "(262) 345-4001";

  const totalQuantity = input.items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );

  const vendorSet = new Set(
    input.items
      .map((item) => String(item.pickupVendor || "").trim())
      .filter(Boolean),
  );

  const vendors = Array.from(vendorSet);
  const summary =
    vendors.length > 0
      ? `Pickup sources: ${vendors.join(", ")}`
      : "Pickup source not specified";

  const normalizedPostal = String(input.postalCode || "").trim();

  if (!normalizedPostal) {
    return {
      cents: baseDeliveryCents,
      serviceName: "Local Delivery",
      serviceCode: "LOCAL_DELIVERY",
      description: "Delivery quote generated without postal code validation",
      eta: "Call for ETA",
      summary,
      outsideDeliveryArea: false,
      outsideDeliveryMiles: 0,
      outsideDeliveryRadius: radiusMiles,
      outsideDeliveryPhone,
    };
  }

  const outsidePrefixes = (process.env.OUTSIDE_DELIVERY_PREFIXES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const isOutsideDeliveryArea = outsidePrefixes.some((prefix) =>
    normalizedPostal.startsWith(prefix),
  );

  if (isOutsideDeliveryArea) {
    return {
      cents: 1,
      serviceName: "Call for delivery quote",
      serviceCode: "CALL_FOR_QUOTE",
      description: "Outside delivery area — please call for custom quote",
      eta: "Call for ETA",
      summary,
      outsideDeliveryArea: true,
      outsideDeliveryMiles: radiusMiles + 1,
      outsideDeliveryRadius: radiusMiles,
      outsideDeliveryPhone,
    };
  }

  const quantitySurchargeCents = Math.max(0, totalQuantity - 1) * 250;
  const cents = baseDeliveryCents + quantitySurchargeCents;

  return {
    cents,
    serviceName: "Local Delivery",
    serviceCode: "LOCAL_DELIVERY",
    description:
      totalQuantity > 1
        ? `Delivery includes ${totalQuantity} items`
        : "Standard local delivery",
    eta: process.env.DEFAULT_DELIVERY_ETA || "1-3 business days",
    summary,
    outsideDeliveryArea: false,
    outsideDeliveryMiles: 0,
    outsideDeliveryRadius: radiusMiles,
    outsideDeliveryPhone,
  };
}