import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const missingSupabaseEnv = [
  !supabaseUrl ? "SUPABASE_URL" : "",
  !supabaseServiceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : "",
].filter(Boolean);

function createMissingSupabaseClient() {
  const message = `Missing required Supabase environment value${
    missingSupabaseEnv.length > 1 ? "s" : ""
  }: ${missingSupabaseEnv.join(", ")}`;

  return new Proxy(
    {},
    {
      get() {
        throw new Error(message);
      },
    },
  ) as ReturnType<typeof createClient>;
}

export const supabaseAdmin = missingSupabaseEnv.length
  ? createMissingSupabaseClient()
  : createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
