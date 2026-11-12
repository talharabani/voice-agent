import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

// Server-only admin client using the service role key.
// NEVER import this file in client components — it bypasses Row Level Security.
export const supabaseAdmin = createSupabaseClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
