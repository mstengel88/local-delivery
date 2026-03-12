import '@shopify/ui-extensions/preact';
import {render} from 'preact';

const PHONE_DISPLAY = '(262) 345-4001';
const PHONE_LINK = 'tel:+12623454001';
const RADIUS = 50;
const OUTSIDE_RATE_CODE = 'CALL_FOR_QUOTE';

export default function extension() {
  render(<App />, document.body);
}

function App() {
  const deliveryGroups = shopify.deliveryGroups?.value || [];

  const allOptions = deliveryGroups.flatMap((group) =>
    Array.isArray(group.deliveryOptions) ? group.deliveryOptions : [],
  );

  const outsideOption = allOptions.find((option) => {
    const code = typeof option?.code === 'string' ? option.code : '';
    return code === OUTSIDE_RATE_CODE;
  });

  const outside = Boolean(outsideOption);

  if (shopify.buyerJourney) {
    shopify.buyerJourney.intercept(({canBlockProgress}) => {
      if (!outside || !canBlockProgress) {
        return {behavior: 'allow'};
      }

      return {
        behavior: 'block',
        reason: 'Outside delivery radius',
        errors: [
          {
            message: `This address is outside our ${RADIUS}-mile delivery radius. Please call ${PHONE_DISPLAY} for a custom delivery quote.`,
          },
        ],
      };
    });
  }

  if (!outside) return null;

  return (
    <s-section>
      <s-banner tone="warning" heading="Outside Delivery Area">
        <s-stack gap="base">
          <s-text>
            This address is outside our {RADIUS}-mile delivery radius, so online
            checkout can’t continue with this delivery address.
          </s-text>

          <s-box
            padding="base"
            border="base"
            border-radius="base"
            background="subdued"
          >
            <s-stack gap="base">
              <s-text emphasis="bold">What to do next</s-text>
              <s-text>• Use an address inside our delivery area, or</s-text>
              <s-text>• Call us for a custom delivery quote.</s-text>
            </s-stack>
          </s-box>

          <s-box
            padding="base"
            border="base"
            border-radius="base"
            background="subdued"
          >
            <s-stack gap="base" inline-alignment="center">
              <s-text emphasis="bold">Call for a custom quote</s-text>
              <s-link href={PHONE_LINK}>{PHONE_DISPLAY}</s-link>
            </s-stack>
          </s-box>

          <s-text appearance="subdued">
            A placeholder delivery option may appear below for review purposes,
            but checkout is blocked until the address is changed or you contact
            us.
          </s-text>
        </s-stack>
      </s-banner>
    </s-section>
  );
}