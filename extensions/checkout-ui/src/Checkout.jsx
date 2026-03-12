import {
  reactExtension,
  Banner,
  BlockStack,
  Text,
  useBuyerJourneyIntercept,
  useDeliverySelectionGroups,
} from "@shopify/ui-extensions-react/checkout";

const OUTSIDE_CODE = "CALL_FOR_QUOTE";
const OUTSIDE_TITLE = "Call for delivery quote";
const OUTSIDE_PHONE = "(262) 345-4001";
const OUTSIDE_RADIUS = 50;

export default reactExtension(
  "purchase.checkout.shipping-option-list.render-before",
  () => <Extension />
);

function Extension() {
  const deliveryGroups = useDeliverySelectionGroups() || [];

  const allOptions = deliveryGroups.flatMap((group) =>
    Array.isArray(group.deliveryOptions) ? group.deliveryOptions : []
  );

  const selectedOptions = deliveryGroups
    .map((group) => {
      const selectedHandle = group.selectedDeliveryOption?.handle;
      return (group.deliveryOptions || []).find(
        (option) => option.handle === selectedHandle
      );
    })
    .filter(Boolean);

  const outsideOption =
    selectedOptions.find((option) => {
      const code = typeof option?.code === "string" ? option.code : "";
      const title = typeof option?.title === "string" ? option.title : "";
      return code === OUTSIDE_CODE || title === OUTSIDE_TITLE;
    }) ||
    allOptions.find((option) => {
      const code = typeof option?.code === "string" ? option.code : "";
      const title = typeof option?.title === "string" ? option.title : "";
      return code === OUTSIDE_CODE || title === OUTSIDE_TITLE;
    });

  const isOutsideRadius = Boolean(outsideOption);

  useBuyerJourneyIntercept(({ canBlockProgress }) => {
    if (!isOutsideRadius || !canBlockProgress) {
      return { behavior: "allow" };
    }

    return {
      behavior: "block",
      reason: "Outside delivery radius",
      errors: [
        {
          message: `This address is outside our ${OUTSIDE_RADIUS}-mile delivery radius. Please call ${OUTSIDE_PHONE} for a custom shipping quote.`,
        },
      ],
    };
  });

  if (!isOutsideRadius) {
    return null;
  }

  return (
    <Banner title="Outside Delivery Area" status="warning">
      <BlockStack spacing="tight">
        <Text>
          This address is outside our {OUTSIDE_RADIUS}-mile delivery radius.
        </Text>
        <Text emphasis="bold">
          Please call us for a custom shipping quote:
        </Text>
        <Text emphasis="bold">{OUTSIDE_PHONE}</Text>
        <Text>
          You can’t continue until you use an address inside our delivery area
          or contact us for a quote.
        </Text>
      </BlockStack>
    </Banner>
  );
}