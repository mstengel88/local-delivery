export const DEFAULT_QUOTE_TAX_RATE = 0.055;

export function getConfiguredQuoteTaxRate() {
  const configuredRate = Number(process.env.QUOTE_TAX_RATE || "");

  return Number.isFinite(configuredRate) && configuredRate > 0
    ? configuredRate
    : DEFAULT_QUOTE_TAX_RATE;
}
