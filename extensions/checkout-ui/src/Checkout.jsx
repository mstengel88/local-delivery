import {
  reactExtension,
  Text,
} from "@shopify/ui-extensions-react/checkout";

export default reactExtension(
  "purchase.checkout.shipping-option-list.render-before",
  () => <Text>LOCAL DELIVERY DEBUG</Text>
);