import type { QuoteProductOption } from "./quote-products.server";

export type QuoteAudience = "customer" | "contractor";
export type ContractorTier = "tier1" | "tier2";

export function normalizeQuoteAudience(value: unknown): QuoteAudience {
  return value === "contractor" ? "contractor" : "customer";
}

export function normalizeContractorTier(value: unknown): ContractorTier {
  return value === "tier2" ? "tier2" : "tier1";
}

export function getUnitPriceForProduct(
  product: QuoteProductOption,
  audience: QuoteAudience,
  contractorTier: ContractorTier,
) {
  if (audience === "contractor") {
    if (contractorTier === "tier2") {
      return product.contractorTier2Price ?? product.contractorTier1Price ?? product.price ?? 0;
    }

    return product.contractorTier1Price ?? product.contractorTier2Price ?? product.price ?? 0;
  }

  return product.price ?? 0;
}

export function getPricingLabel(
  audience: QuoteAudience,
  contractorTier: ContractorTier,
) {
  if (audience === "contractor") {
    return contractorTier === "tier2" ? "Contractor Tier 2" : "Contractor Tier 1";
  }

  return "Customer";
}
