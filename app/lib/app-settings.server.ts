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

export async function getAppSettings(shop: string) {
  const { data, error } = await supabaseAdmin
    .from("shopify_app_settings")
    .select("*")
    .eq("shop", shop)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return {
      shop,
      useTestFlatRate: false,
      testFlatRateCents: 5000,
      enableCalculatedRates: true,
      enableRemoteSurcharge: true,
      enableDebugLogging: false,
      showVendorSource: true,
    };
  }

  return {
    shop: data.shop,
    useTestFlatRate: data.use_test_flat_rate,
    testFlatRateCents: data.test_flat_rate_cents,
    enableCalculatedRates: data.enable_calculated_rates,
    enableRemoteSurcharge: data.enable_remote_surcharge,
    enableDebugLogging: data.enable_debug_logging,
    showVendorSource: data.show_vendor_source,
  };
}

export async function saveAppSettings(
  shop: string,
  values: {
    useTestFlatRate: boolean;
    testFlatRateCents: number;
    enableCalculatedRates: boolean;
    enableRemoteSurcharge: boolean;
    enableDebugLogging: boolean;
    showVendorSource: boolean;
  },
) {
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
    .select()
    .single();

  if (error) {
    console.error("[SAVE APP SETTINGS ERROR]", error);
    throw error;
  }

  return data;
}