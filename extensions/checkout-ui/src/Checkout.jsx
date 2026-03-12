import '@shopify/ui-extensions/preact';
import {render} from 'preact';

const PHONE_DISPLAY = '(262) 345-4001';
const PHONE_LINK = 'tel:+12623454001';
const DELIVERY_RADIUS = 50;
const RATE_CODE = 'CALL_FOR_QUOTE';
const RATE_TITLE = 'Call for delivery quote';

export default function extension() {
  render(<App />, document.body);
}

function App() {
  const deliveryGroups = shopify.deliveryGroups?.value ?? [];

  const options = deliveryGroups.flatMap((group) =>
    Array.isArray(group.deliveryOptions) ? group.deliveryOptions : [],
  );

  const outsideRate = options.find((option) =>
    option?.code === RATE_CODE || option?.title === RATE_TITLE,
  );

  const outsideRadius = Boolean(outsideRate);

  if (shopify.buyerJourney) {
    shopify.buyerJourney.intercept(({canBlockProgress}) => {
      if (!outsideRadius || !canBlockProgress) {
        return {behavior: 'allow'};
      }

      return {
        behavior: 'block',
        reason: 'Outside delivery radius',
        errors: [
          {
            message: `This address is outside our ${DELIVERY_RADIUS}-mile delivery radius. Please call ${PHONE_DISPLAY} for a delivery quote.`,
          },
        ],
      };
    });
  }

  if (!outsideRadius) return null;

  return (
    <s-box border="base" borderRadius="large" padding="large" background="subdued">
      <s-stack gap="large">
        <s-heading>Outside Delivery Area</s-heading>

        <s-text>
          This address is outside our {DELIVERY_RADIUS}-mile delivery radius.
        </s-text>

        <s-text appearance="subdued">
          Online checkout can’t continue with this delivery address.
        </s-text>

        <s-box border="base" borderRadius="base" padding="base">
          <s-stack gap="tight">
            <s-text emphasis="bold">What you can do</s-text>
            <s-text>• Enter an address inside our delivery area</s-text>
            <s-text>• Call us for a custom delivery quote</s-text>
          </s-stack>
        </s-box>

        <s-button href={PHONE_LINK} appearance="primary">
          Call {PHONE_DISPLAY}
        </s-button>

        <s-text appearance="subdued">
          A placeholder delivery option may appear below for review, but checkout
          is blocked until the address is changed or you contact us.
        </s-text>
      </s-stack>
    </s-box>
  );
}