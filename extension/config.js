/**
 * LeetFlow Extension Configuration
 * ─────────────────────────────────────────────────────
 * These point at the LeetFlow project this extension syncs to. To use your
 * own Supabase project and dashboard, replace them — and update the dashboard
 * URL in manifest.json too (host_permissions and the auth-bridge.js
 * content-script match), since a manifest can't read this file.
 *
 * Supabase values: Settings → API → Project URL & anon/publishable key.
 * The publishable key is meant to be public; access is enforced by RLS.
 */

export const SUPABASE_URL = "https://zylgxhizghgqlgyfidlf.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_QatOuFPRr65ebt-w_ynZug_dUH-9pyv";

// Where the dashboard is deployed (used by the popup and the auth bridge).
export const DASHBOARD_URL = "https://ana-leet.vercel.app/";
