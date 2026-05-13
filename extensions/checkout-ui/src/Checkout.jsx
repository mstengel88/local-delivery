import '@shopify/ui-extensions/preact';
import {
  useBuyerJourneyIntercept,
  useCartLines,
  useDeliveryGroups,
  useShippingAddress,
} from '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useMemo, useState} from 'preact/hooks';

const APP_URL = 'https://app.ghstickets.com';
const PHONE_DISPLAY = '(262) 345-4001';
const PHONE_LINK = 'tel:+12623454001';
const DELIVERY_RADIUS = 50;
const MODAL_ID = 'outside-delivery-modal';

export default function extension() {
  render(<App />, document.body);
}

function getSelectedOption(deliveryGroups) {
  for (const group of deliveryGroups || []) {
    const selectedHandle = group?.selectedDeliveryOption?.handle;
    if (!selectedHandle) continue;

    const option = (group.deliveryOptions || []).find(
      (deliveryOption) => deliveryOption.handle === selectedHandle,
    );
    if (option) return option;
  }

  return null;
}

function isPickupSelected(deliveryGroups) {
  return getSelectedOption(deliveryGroups)?.type === 'pickup';
}

function hasEnoughAddress(address) {
  return Boolean(address?.address1 && address?.city && address?.zip);
}

function buildEstimatePayload(address, lines) {
  return {
    shippingAddress: {
      address1: address?.address1 || '',
      address2: address?.address2 || '',
      city: address?.city || '',
      provinceCode: address?.provinceCode || '',
      zip: address?.zip || '',
      countryCode: address?.countryCode || 'US',
    },
    lines: (lines || []).map((line) => ({
      sku: line?.merchandise?.sku || '',
      quantity: line?.quantity || 0,
      grams: 0,
      price: 0,
      vendor: line?.merchandise?.product?.vendor || '',
    })),
  };
}

function App() {
  const shippingAddress = useShippingAddress();
  const deliveryGroups = useDeliveryGroups();
  const cartLines = useCartLines();
  const pickupSelected = isPickupSelected(deliveryGroups);
  const [estimateState, setEstimateState] = useState({
    status: 'idle',
    outsideDeliveryArea: false,
    outsideDeliveryRadius: DELIVERY_RADIUS,
    outsideDeliveryPhone: PHONE_DISPLAY,
    message: '',
  });

  const estimateKey = useMemo(
    () =>
      JSON.stringify({
        address1: shippingAddress?.address1 || '',
        address2: shippingAddress?.address2 || '',
        city: shippingAddress?.city || '',
        provinceCode: shippingAddress?.provinceCode || '',
        zip: shippingAddress?.zip || '',
        countryCode: shippingAddress?.countryCode || 'US',
        lines: (cartLines || []).map((line) => [
          line?.merchandise?.sku || '',
          line?.quantity || 0,
          line?.merchandise?.product?.vendor || '',
        ]),
      }),
    [cartLines, shippingAddress],
  );

  useEffect(() => {
    if (!hasEnoughAddress(shippingAddress) || !cartLines?.length) {
      setEstimateState((current) => ({
        ...current,
        status: 'idle',
        outsideDeliveryArea: false,
        message: '',
      }));
      return;
    }

    const controller = new AbortController();

    setEstimateState((current) => ({
      ...current,
      status: 'checking',
      message: '',
    }));

    fetch(`${APP_URL}/api/shipping-estimate`, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain'},
      body: JSON.stringify(buildEstimatePayload(shippingAddress, cartLines)),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Delivery check failed (${response.status})`);
        return response.json();
      })
      .then((result) => {
        setEstimateState({
          status: 'ready',
          outsideDeliveryArea: Boolean(result?.outsideDeliveryArea),
          outsideDeliveryRadius: result?.outsideDeliveryRadius || DELIVERY_RADIUS,
          outsideDeliveryPhone: result?.outsideDeliveryPhone || PHONE_DISPLAY,
          message: result?.description || '',
        });
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setEstimateState({
          status: 'error',
          outsideDeliveryArea: true,
          outsideDeliveryRadius: DELIVERY_RADIUS,
          outsideDeliveryPhone: PHONE_DISPLAY,
          message: 'We could not verify this address for delivery.',
        });
      });

    return () => controller.abort();
  }, [cartLines, estimateKey, shippingAddress]);

  const shouldRestrictDelivery =
    estimateState.outsideDeliveryArea || estimateState.status === 'error';
  const shouldBlockProgress = shouldRestrictDelivery && !pickupSelected;
  const radius = estimateState.outsideDeliveryRadius || DELIVERY_RADIUS;
  const phone = estimateState.outsideDeliveryPhone || PHONE_DISPLAY;

  useBuyerJourneyIntercept(({canBlockProgress}) => {
    if (!shouldBlockProgress || !canBlockProgress) {
      return {behavior: 'allow'};
    }

    return {
      behavior: 'block',
      reason: 'Delivery is not available for this address',
      errors: [
        {
          message:
            estimateState.status === 'error'
              ? `Shipping is not available for this address. Please choose in-store pickup or call/text ${phone} for a custom quote.`
              : `Shipping is not available for this address because it is outside our ${radius}-mile delivery area. Please choose in-store pickup or call/text ${phone} for a custom quote.`,
        },
      ],
    };
  });

  if (!shouldRestrictDelivery) return null;

  return (
    <>
      <s-box
        border="base"
        borderRadius="large"
        padding="large"
        background="subdued"
      >
        <s-stack gap="large">
          <s-heading>Shipping not available</s-heading>

          <s-text>
            {estimateState.status === 'error'
              ? 'Shipping is not available for this address.'
              : `Shipping is not available for this address because it is outside our ${radius}-mile delivery area.`}
          </s-text>

          <s-text appearance="subdued">
            Please choose in-store pickup to complete checkout, or call/text
            {` ${phone} `}for a custom delivery quote.
          </s-text>

          {pickupSelected ? (
            <s-text appearance="success">
              In-store pickup is selected, so you can continue checkout.
            </s-text>
          ) : (
            <s-text appearance="critical">
              Delivery checkout is blocked until in-store pickup is selected.
            </s-text>
          )}

          <s-stack direction="inline" gap="base">
            <s-button href={PHONE_LINK} appearance="primary">
              Call/Text {phone}
            </s-button>

            <s-button command="--show" commandFor={MODAL_ID}>
              More details
            </s-button>
          </s-stack>
        </s-stack>
      </s-box>

      <s-modal id={MODAL_ID} heading="Shipping not available">
        <s-stack gap="large">
          <s-text>
            {estimateState.status === 'error'
              ? 'Shipping is not available for this address.'
              : `Shipping is not available for this address because it is outside our ${radius}-mile delivery area.`}
          </s-text>

          <s-box
            border="base"
            borderRadius="base"
            padding="base"
            background="subdued"
          >
            <s-stack gap="tight">
              <s-text emphasis="bold">What you can do</s-text>
              <s-text>• Choose in-store pickup and complete checkout</s-text>
              <s-text>• Enter a delivery address inside our delivery area</s-text>
              <s-text>• Call or text us for a custom delivery quote</s-text>
            </s-stack>
          </s-box>

          <s-box
            border="base"
            borderRadius="base"
            padding="base"
            background="subdued"
          >
            <s-stack gap="tight">
              <s-text emphasis="bold">Call/Text for a quote</s-text>
              <s-link href={PHONE_LINK}>{phone}</s-link>
            </s-stack>
          </s-box>
        </s-stack>

        <s-button
          slot="primary-action"
          command="--hide"
          commandFor={MODAL_ID}
        >
          Close
        </s-button>
      </s-modal>
    </>
  );
}
