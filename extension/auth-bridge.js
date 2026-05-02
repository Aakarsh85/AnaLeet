/**
 * LeetFlow Auth Bridge
 * Injected on ana-leet.vercel.app by the extension.
 *
 * Reads the Supabase session from localStorage and forwards it
 * to the background service worker via SET_SESSION / CLEAR_SESSION.
 * Also listens for real-time login and logout via the storage event.
 *
 * No dashboard code changes required.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "sb-zylgxhizghgqlgyfidlf-auth-token";

  // ─── Parse and forward the current session ─────────────────────────────────
  function forwardSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // Nothing in storage — clear any stale session in the extension
        chrome.runtime.sendMessage({ type: "CLEAR_SESSION" });
        return;
      }

      const parsed = JSON.parse(raw);

      // Supabase stores { access_token, refresh_token, user, expires_at, … }
      const accessToken = parsed?.access_token;
      if (!accessToken) {
        chrome.runtime.sendMessage({ type: "CLEAR_SESSION" });
        return;
      }

      chrome.runtime.sendMessage({
        type: "SET_SESSION",
        session: parsed,
      }, (response) => {
        if (chrome.runtime.lastError) {
          // Extension context gone — nothing to do, bridge will re-fire on next page load
          return;
        }
        console.log("[LeetFlow] Session forwarded to extension:", response);
      });
    } catch (err) {
      console.warn("[LeetFlow] Auth bridge error:", err.message);
    }
  }

  // ─── Listen for login / logout in real time ────────────────────────────────
  // Supabase writes/clears localStorage on sign-in and sign-out.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;

    if (!event.newValue) {
      // Key was removed → user signed out
      chrome.runtime.sendMessage({ type: "CLEAR_SESSION" });
      console.log("[LeetFlow] Session cleared (sign-out detected)");
      return;
    }

    // Key was written → user signed in or session refreshed
    forwardSession();
  });

  // ─── Forward immediately on page load ─────────────────────────────────────
  // Handles the case where the user is already logged in when they open the dashboard.
  forwardSession();
})();
