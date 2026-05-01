import { createClient } from "@supabase/supabase-js";

// ─── Replace with your Supabase project credentials ───────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "YOUR_SUPABASE_ANON_KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}
