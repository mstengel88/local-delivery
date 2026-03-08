// extensions/checkout-estimator/src/Checkout.jsx
import {
  reactExtension,
  Banner,
  BlockStack,
  Text,
  Spinner,
  useApi
} from "@shopify/ui-extensions-react/checkout";
import {useEffect, useState} from "react";

export default reactExtension(
  "purchase.checkout.shipping-option-list.render-before",
  () => <Extension />
);

function Extension() {
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEstimate() {
      try {
        setLoading(true);
        setError("");

        const payload = {
          shippingAddress: api.shippingAddress?.current,
          lines: (api.lines?.current || []).map((line) => ({
            quantity: line.quantity,
            sku: line.merchandise?.sku || "",
            grams: line.merchandise?.weight || 0,
            price: line.cost?.totalAmount?.amount || 0
          }))
        };

        const response = await fetch("https://your-public-app-domain.com/api/shipping-estimate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error("Failed to load shipping estimate");
        }

        const json = await response.json();
        if (active) {
          setData(json);
        }
      } catch (err) {
        if (active) {
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
  }, [api]);

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
      <Banner status="warning">
        <Text>{error}</Text>
      </Banner>
    );
  }

  if (!data) return null;

  return (
    <Banner>
      <BlockStack spacing="tight">
        <Text emphasis="bold">{data.summary}</Text>
        <Text>{data.description}</Text>
        <Text>Estimated delivery: {data.eta}</Text>
      </BlockStack>
    </Banner>
  );
}