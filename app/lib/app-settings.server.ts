import { supabaseAdmin } from "./supabase.server";

export async function getAppSettings(shop: string) {
  const { data, error } = await supabaseAdmin
    .from("shopify_app_settings")
    .select("*")
    .eq("shop", shop)
    .single();

  if (data) {
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

  const defaults = {
    shop,
    use_test_flat_rate: false,
    test_flat_rate_cents: 5000,
    enable_calculated_rates: true,
    enable_remote_surcharge: true,
    enable_debug_logging: false,
    show_vendor_source: true,
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("shopify_app_settings")
    .insert(defaults)
    .select()
    .single();

  if (insertError) {
    throw insertError;
  }

  return {
    shop: inserted.shop,
    useTestFlatRate: inserted.use_test_flat_rate,
    testFlatRateCents: inserted.test_flat_rate_cents,
    enableCalculatedRates: inserted.enable_calculated_rates,
    enableRemoteSurcharge: inserted.enable_remote_surcharge,
    enableDebugLogging: inserted.enable_debug_logging,
    showVendorSource: inserted.show_vendor_source,
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
  }
) {
  const payload = {
    shop,
    use_test_flat_rate: values.useTestFlatRate,
    test_flat_rate_cents: values.testFlatRateCents,
    enable_calculated_rates: values.enableCalculatedRates,
    enable_remote_surcharge: values.enableRemoteSurcharge,
    enable_debug_logging: values.enableDebugLogging,
    show_vendor_source: values.showVendorSource,
  };

  const { data, error } = await supabaseAdmin
    .from("shopify_app_settings")
    .upsert(payload)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}
