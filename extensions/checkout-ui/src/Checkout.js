import {
  extension,
  Text,
} from "@shopify/ui-extensions/checkout";

export default extension(
  "purchase.checkout.block.render",
  (root) => {
    root.append(
      root.createComponent(Text, {}, "LOCAL DELIVERY DEBUG")
    );
  }
);