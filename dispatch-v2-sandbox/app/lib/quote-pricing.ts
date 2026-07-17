import type { QuoteProductOption } from "./quote-products.server";

export type QuoteAudience = "customer" | "contractor" | "custom";
export type ContractorTier = "tier1" | "tier2";

export function normalizeQuoteAudience(value: unknown): QuoteAudience {
  if (value === "contractor") return "contractor";
  if (value === "custom") return "custom";
  return "customer";
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

  if (audience === "custom") {
    return product.price ?? product.contractorTier1Price ?? product.contractorTier2Price ?? 0;
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

  if (audience === "custom") {
    return "Custom";
  }

  return "Customer";
}
