import { createClient } from "@supabase/supabase-js";

// Set in dashboard/.env (see .env.example). `?? {}` lets this module load
// outside Vite (e.g. under node's test runner).
const env = import.meta.env ?? {};
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[LeetFlow] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (dashboard/.env locally, " +
    "or the host's environment variables when deployed)."
  );
}

export const supabase = createClient(
  SUPABASE_URL || "https://missing-config.supabase.co",
  SUPABASE_ANON_KEY || "missing-config",
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);
