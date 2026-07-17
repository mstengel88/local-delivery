import { supabaseAdmin } from "./supabase.server";

type AppSettingsRow = {
  shop: string;
  use_test_flat_rate: boolean;
  test_flat_rate_cents: number;
  enable_calculated_rates: boolean;
  enable_remote_surcharge: boolean;
  enable_debug_logging: boolean;
  show_vendor_source: boolean;
  updated_at?: string;
};

export type AppSettings = {
  shop: string;
  useTestFlatRate: boolean;
  testFlatRateCents: number;
  enableCalculatedRates: boolean;
  enableRemoteSurcharge: boolean;
  enableDebugLogging: boolean;
  showVendorSource: boolean;
};

const DEFAULT_APP_SETTINGS: Omit<AppSettings, "shop"> = {
  useTestFlatRate: false,
  testFlatRateCents: 5000,
  enableCalculatedRates: true,
  enableRemoteSurcharge: true,
  enableDebugLogging: false,
  showVendorSource: true,
};

function mapRowToSettings(row: Partial<AppSettingsRow> | null, shop: string): AppSettings {
  return {
    shop,
    useTestFlatRate: row?.use_test_flat_rate ?? DEFAULT_APP_SETTINGS.useTestFlatRate,
    testFlatRateCents: row?.test_flat_rate_cents ?? DEFAULT_APP_SETTINGS.testFlatRateCents,
    enableCalculatedRates:
      row?.enable_calculated_rates ?? DEFAULT_APP_SETTINGS.enableCalculatedRates,
    enableRemoteSurcharge:
      row?.enable_remote_surcharge ?? DEFAULT_APP_SETTINGS.enableRemoteSurcharge,
    enableDebugLogging:
      row?.enable_debug_logging ?? DEFAULT_APP_SETTINGS.enableDebugLogging,
    showVendorSource: row?.show_vendor_source ?? DEFAULT_APP_SETTINGS.showVendorSource,
  };
}

export async function getAppSettings(shop: string): Promise<AppSettings> {
  const { data, error } = await supabaseAdmin
    .from("shopify_app_settings")
    .select("*")
    .eq("shop", shop)
    .maybeSingle();

  if (error) {
    console.error("[GET APP SETTINGS ERROR]", error);
    return {
      shop,
      ...DEFAULT_APP_SETTINGS,
    };
  }

  return mapRowToSettings(data, shop);
}

export async function saveAppSettings(
  shop: string,
  values: Omit<AppSettings, "shop">,
): Promise<AppSettings> {
  const payload: AppSettingsRow = {
    shop,
    use_test_flat_rate: values.useTestFlatRate,
    test_flat_rate_cents: values.testFlatRateCents,
    enable_calculated_rates: values.enableCalculatedRates,
    enable_remote_surcharge: values.enableRemoteSurcharge,
    enable_debug_logging: values.enableDebugLogging,
    show_vendor_source: values.showVendorSource,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("shopify_app_settings")
    .upsert(payload, { onConflict: "shop" })
    .select("*")
    .single();

  if (error) {
    console.error("[SAVE APP SETTINGS ERROR]", error);
    throw error;
  }

  return mapRowToSettings(data, shop);
}