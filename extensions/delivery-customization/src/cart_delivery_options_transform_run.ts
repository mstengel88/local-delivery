import type {
  CartDeliveryOptionsTransformRunInput,
  CartDeliveryOptionsTransformRunResult,
} from "../generated/api";

const NO_CHANGES: CartDeliveryOptionsTransformRunResult = {
  operations: [],
};

type Configuration = {};

export function cartDeliveryOptionsTransformRun(input: CartDeliveryOptionsTransformRunInput): CartDeliveryOptionsTransformRunResult {
  const configuration: Configuration = input?.deliveryCustomization?.metafield?.jsonValue ?? {};
  return NO_CHANGES;
};