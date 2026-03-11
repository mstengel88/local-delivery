import {
  reactExtension,
  Banner,
  BlockStack,
  Text,
  Spinner,
  useApi,
  useBuyerJourneyIntercept,
  useShippingAddress,
  useCartLines,
} from "@shopify/ui-extensions-react/checkout";
import {useEffect, useMemo, useState} from "react";

export default reactExtension(
  "purchase.checkout.delivery-address.render-after",
  () => <Extension />
);

function Extension() {
  const api = useApi();
  const shippingAddress = useShippingAddress();
  const lines = useCartLines();

  const [loading, setLoading] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [error, setError] = useState("");

  const payload = useMemo(() => {
    return {
      shop: api.shop?.myshopifyDomain || "",
      shippingAddress: {
        address1: shippingAddress?.address1 || "",
        address2: shippingAddress?.address2 || "",
        city: shippingAddress?.city || "",
        provinceCode: shippingAddress?.provinceCode || "",
        zip: shippingAddress?.zip || "",
        countryCode: shippingAddress?.countryCode || "US",
      },
      lines: (lines || []).map((line) => ({
        quantity: line.quantity || 0,
        sku: line.merchandise?.sku || "",
        grams: line.merchandise?.weight || 0,
        price: Number(line.cost?.totalAmount?.amount || 0),
        vendor:
          line.merchandise?.product?.vendor ||
          line.merchandise?.vendor ||
          "",
      })),
    };
  }, [api.shop?.myshopifyDomain, shippingAddress, lines]);

  useEffect(() => {
    let active = true;

    async function loadEstimate() {
      if (!payload.shippingAddress.zip) {
        setEstimate(null);
        setError("");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          "https://app.ghstickets.com/api.shipping-estimate",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-shopify-shop-domain": api.shop?.myshopifyDomain || "",
            },
            body: JSON.stringify(payload),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to load shipping estimate");
        }

        const json = await response.json();

        if (active) {
          setEstimate(json);
        }
      } catch (err) {
        if (active) {
          setEstimate(null);
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadEstimate();

    return () => {
      active = false;
    };
  }, [payload, api.shop?.myshopifyDomain]);

  const isOutsideRadius = Boolean(estimate?.outsideDeliveryArea);

  useBuyerJourneyIntercept(({canBlockProgress}) => {
    if (!isOutsideRadius || !canBlockProgress) {
      return {behavior: "allow"};
    }

    return {
      behavior: "block",
      reason: "Outside delivery radius",
      errors: [
        {
          message: `This address is ${estimate?.outsideDeliveryMiles || 0} miles away and outside our ${estimate?.outsideDeliveryRadius || 50}-mile delivery radius. Please call ${estimate?.outsideDeliveryPhone || "(262) 345-4001"} for a custom shipping quote.`,
        },
      ],
    };
  });

  if (loading) {
    return (
      <Banner title="Local delivery quote" status="info">
        <BlockStack spacing="tight">
          <Spinner />
          <Text>Checking delivery distance…</Text>
        </BlockStack>
      </Banner>
    );
  }

  if (error) {
    return (
      <Banner title="Shipping estimate unavailable" status="warning">
        <Text>{error}</Text>
      </Banner>
    );
  }

  if (!estimate) return null;

  if (isOutsideRadius) {
    return (
      <Banner title="Outside Delivery Area" status="warning">
        <BlockStack spacing="tight">
          <Text>
            Your destination is {estimate.outsideDeliveryMiles} miles away,
            which exceeds our {estimate.outsideDeliveryRadius}-mile delivery radius.
          </Text>
          <Text emphasis="bold">
            Please call us for a custom shipping quote:
          </Text>
          <Text emphasis="bold">{estimate.outsideDeliveryPhone}</Text>
          <Text>
            You can’t continue with this address until you choose an address
            inside our delivery area or contact us for a custom quote.
          </Text>
        </BlockStack>
      </Banner>
    );
  }

  return null;
}