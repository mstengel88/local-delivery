// extensions/checkout-estimator/src/Checkout.jsx
import {
  reactExtension,
  BlockStack,
  Text,
  Spinner,
  Link,
  Icon,
  useApi,
  View,
} from "@shopify/ui-extensions-react/checkout";
import { useEffect, useMemo, useState } from "react";

export default reactExtension(
  "purchase.checkout.shipping-option-list.render-before",
  () => <Extension />
);

function Extension() {
  const api = useApi();
  const [loading, setLoading] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [error, setError] = useState("");

  const shippingAddress = api.shippingAddress?.current;
  const lines = api.lines?.current || [];

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
      lines: lines.map((line) => ({
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

  if (loading) {
    return (
      <BlockStack spacing="tight">
        <Spinner />
        <Text>Calculating shipping…</Text>
      </BlockStack>
    );
  }

  if (error) {
    return (
      <View
        border="base"
        cornerRadius="large"
        padding="base"
        background="subdued"
      >
        <BlockStack spacing="tight" inlineAlignment="center">
          <Text emphasis="bold">Shipping estimate unavailable</Text>
          <Text appearance="subdued">{error}</Text>
        </BlockStack>
      </View>
    );
  }

  if (!estimate) return null;

  if (estimate.outsideDeliveryArea) {
    return (
      <View
        border="base"
        cornerRadius="large"
        padding="loose"
        background="subdued"
      >
        <BlockStack spacing="base" inlineAlignment="center">
          <Icon source="phone" />
          <Text size="large" emphasis="bold">
            Outside Delivery Area
          </Text>
          <Text appearance="subdued" alignment="center">
            Your destination is {estimate.outsideDeliveryMiles} miles away,
            which exceeds our {estimate.outsideDeliveryRadius}-mile delivery
            radius.
          </Text>
          <Text emphasis="bold" alignment="center">
            Please call us for a custom shipping quote:
          </Text>
          <Link to={`tel:${estimate.outsideDeliveryPhone}`}>
            <Text size="large" emphasis="bold" alignment="center">
              {estimate.outsideDeliveryPhone}
            </Text>
          </Link>
        </BlockStack>
      </View>
    );
  }

  return (
    <View
      border="base"
      cornerRadius="large"
      padding="base"
      background="subdued"
    >
      <BlockStack spacing="tight">
        <Text emphasis="bold">{estimate.summary}</Text>
        <Text>{estimate.description}</Text>
        <Text appearance="subdued">Estimated delivery: {estimate.eta}</Text>
      </BlockStack>
    </View>
  );
}