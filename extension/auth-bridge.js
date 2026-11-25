/**
 * LeetFlow Auth Bridge
 * Runs on the dashboard (see the auth-bridge.js match in manifest.json) and
 * keeps the extension and the dashboard on the same, newest Supabase session.
 *
 * Both sides can refresh the session, and Supabase rotates the refresh token
 * on every refresh: a side still holding the old token would fail its next
 * refresh and be signed out. So:
 *  - dashboard → extension: the dashboard's session is forwarded whenever it
 *    changes (sign-in, sign-out, token refresh);
 *  - extension → dashboard: if the extension refreshed the session (e.g. while
 *    the dashboard was closed), its newer session is written into the
 *    dashboard's storage. supabase-js re-reads storage before every refresh,
 *    and this script runs at document_start, so the dashboard starts with the
 *    newest session.
 *
 * No dashboard code changes required.
 */

(function () {
  "use strict";

  // supabase-js stores the session under "sb-<project-ref>-auth-token"
  const KEY_PATTERN = /^sb-[a-z0-9]+-auth-token$/;
  // The dashboard refreshing its own token doesn't fire a "storage" event in
  // the same tab, so also check for changes periodically.
  const POLL_MS = 5000;

  let lastForwarded; // raw stored value last sent to the extension

  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  function send(message) {
    if (!isContextValid()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function findStorageKey() {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (KEY_PATTERN.test(key)) return key;
    }
    return null;
  }

  function parseSession(raw) {
    try {
      const session = JSON.parse(raw);
      return session?.access_token ? session : null;
    } catch (_) {
      return null;
    }
  }

  // ─── Dashboard → extension ─────────────────────────────────────────────────
  function forwardSession() {
    try {
      const key = findStorageKey();
      const raw = key ? localStorage.getItem(key) : null;
      if (raw === lastForwarded) return;
      lastForwarded = raw;

      const session = parseSession(raw);
      send(session ? { type: "SET_SESSION", session } : { type: "CLEAR_SESSION" });
    } catch (err) {
      console.warn("[LeetFlow] Auth bridge error:", err.message);
    }
  }

  // ─── Extension → dashboard ─────────────────────────────────────────────────
  // Only replaces a stored session for the same user, and only with a newer one.
  function adoptIfNewer(session) {
    try {
      const key = findStorageKey();
      if (!key || !session?.access_token) return;
      const current = parseSession(localStorage.getItem(key));
      if (!current || current.user?.id !== session.user?.id) return;
      if ((session.expires_at ?? 0) <= (current.expires_at ?? 0)) return;

      const raw = JSON.stringify(session);
      localStorage.setItem(key, raw);
      lastForwarded = raw; // the extension already has this one
    } catch (err) {
      console.warn("[LeetFlow] Auth bridge error:", err.message);
    }
  }

  if (isContextValid()) {
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === "SESSION_UPDATED") adoptIfNewer(msg.session);
      });
    } catch (_) {}
  }

  // Real-time login / logout from other tabs
  window.addEventListener("storage", (event) => {
    if (event.key === null || KEY_PATTERN.test(event.key)) forwardSession();
  });

  const poll = setInterval(() => {
    if (!isContextValid()) {
      clearInterval(poll); // extension reloaded — this copy is orphaned
      return;
    }
    forwardSession();
  }, POLL_MS);

  // On page load: take the extension's session first if it is newer, then
  // report the dashboard's (possibly updated) session back.
  send({ type: "GET_SESSION" }).then((response) => {
    if (response?.session) adoptIfNewer(response.session);
    forwardSession();
  });
})();
