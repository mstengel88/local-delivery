export const DEFAULT_QUOTE_TAX_RATE = 0.055;

export function getConfiguredQuoteTaxRate() {
  const configuredRate = Number(process.env.QUOTE_TAX_RATE || "");

  return Number.isFinite(configuredRate) && configuredRate > 0
    ? configuredRate
    : DEFAULT_QUOTE_TAX_RATE;
}

export type QuoteTaxAddress = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export type QuoteTaxRule = {
  label?: string;
  rate: number | string;
  cities?: string[];
  postalCodes?: string[];
  postalCodePrefixes?: string[];
  province?: string;
  country?: string;
  addressIncludes?: string[];
};

export type QuoteTaxRateMatch = {
  rate: number;
  label: string;
  matchedRule: boolean;
};

function normalizeText(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizePostalCode(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeRate(value: number | string) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) return null;

  return rate > 1 ? rate / 100 : rate;
}

function splitCsv(value?: string | null) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCityFromAddress(address: QuoteTaxAddress) {
  const directCity = String(address.city || "").trim();
  if (directCity) {
    return directCity.split(",")[0]?.trim() || directCity;
  }

  const addressText = [address.address1, address.address2].filter(Boolean).join(", ");
  const parts = addressText.split(",").map((part) => part.trim()).filter(Boolean);

  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

function parsePostalCodeFromAddress(address: QuoteTaxAddress) {
  const directPostalCode = normalizePostalCode(address.postalCode);
  if (directPostalCode) return directPostalCode;

  const addressText = [address.address1, address.address2, address.city]
    .filter(Boolean)
    .join(" ");
  const match = addressText.match(/\b\d{5}(?:-\d{4})?\b/);

  return match ? normalizePostalCode(match[0]) : "";
}

function getConfiguredTaxRules(): QuoteTaxRule[] {
  const rules: QuoteTaxRule[] = [];
  const cityRate = normalizeRate(process.env.QUOTE_MILWAUKEE_CITY_TAX_RATE || "");
  const countyRate = normalizeRate(process.env.QUOTE_MILWAUKEE_COUNTY_TAX_RATE || "");

  if (cityRate !== null) {
    rules.push({
      label: "Milwaukee city",
      rate: cityRate,
      cities: ["Milwaukee"],
      province: "WI",
      country: "US",
    });
  }

  if (countyRate !== null) {
    const cities = splitCsv(process.env.QUOTE_MILWAUKEE_COUNTY_CITIES);
    const postalCodes = splitCsv(process.env.QUOTE_MILWAUKEE_COUNTY_POSTAL_CODES);
    const postalCodePrefixes = splitCsv(process.env.QUOTE_MILWAUKEE_COUNTY_POSTAL_PREFIXES);

    if (cities.length || postalCodes.length || postalCodePrefixes.length) {
      rules.push({
        label: "Milwaukee County",
        rate: countyRate,
        cities,
        postalCodes,
        postalCodePrefixes,
        province: "WI",
        country: "US",
      });
    }
  }

  const rawRules = String(process.env.QUOTE_TAX_RATE_RULES || "").trim();
  if (!rawRules) return rules;

  try {
    const parsed = JSON.parse(rawRules);
    if (Array.isArray(parsed)) {
      for (const rule of parsed) {
        if (!rule || typeof rule !== "object") continue;
        const rate = normalizeRate((rule as QuoteTaxRule).rate);
        if (rate === null) continue;
        rules.push({ ...(rule as QuoteTaxRule), rate });
      }
    }
  } catch (error) {
    console.warn("[QUOTE TAX RULES ERROR]", error);
  }

  return rules;
}

function ruleMatches(rule: QuoteTaxRule, address: QuoteTaxAddress) {
  const city = normalizeText(parseCityFromAddress(address));
  const fullCity = normalizeText(address.city);
  const province = normalizeText(address.province);
  const country = normalizeText(address.country || "US");
  const postalCode = parsePostalCodeFromAddress(address);
  const fullAddress = normalizeText(
    [address.address1, address.address2, address.city, address.province, address.postalCode, address.country]
      .filter(Boolean)
      .join(" "),
  );

  if (rule.province && province && normalizeText(rule.province) !== province) return false;
  if (rule.country && country && normalizeText(rule.country) !== country) return false;

  const cities = (rule.cities || []).map(normalizeText).filter(Boolean);
  const postalCodes = (rule.postalCodes || []).map(normalizePostalCode).filter(Boolean);
  const postalCodePrefixes = (rule.postalCodePrefixes || []).map(normalizePostalCode).filter(Boolean);
  const addressIncludes = (rule.addressIncludes || []).map(normalizeText).filter(Boolean);

  const hasSpecificMatcher =
    cities.length || postalCodes.length || postalCodePrefixes.length || addressIncludes.length;

  if (!hasSpecificMatcher) return true;

  return (
    cities.some((ruleCity) => city === ruleCity || fullCity.includes(ruleCity)) ||
    postalCodes.some((rulePostalCode) => postalCode === rulePostalCode) ||
    postalCodePrefixes.some((prefix) => postalCode.startsWith(prefix)) ||
    addressIncludes.some((text) => fullAddress.includes(text))
  );
}

export function getQuoteTaxRateForAddress(address: QuoteTaxAddress): QuoteTaxRateMatch {
  const fallbackRate = getConfiguredQuoteTaxRate();
  const rules = getConfiguredTaxRules();

  for (const rule of rules) {
    const rate = normalizeRate(rule.rate);
    if (rate === null) continue;
    if (!ruleMatches(rule, address)) continue;

    return {
      rate,
      label: rule.label || "Local tax",
      matchedRule: true,
    };
  }

  return {
    rate: fallbackRate,
    label: "Default tax",
    matchedRule: false,
  };
}
