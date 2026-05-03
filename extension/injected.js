/**
 * LeetFlow Injected Script
 * Runs in the MAIN world (page context) — not the isolated content script world.
 * This is the only way to intercept LeetCode's fetch calls.
 *
 * Communicates back to content.js via window.postMessage.
 * Never touches chrome.* APIs — those are not available in the MAIN world.
 */

(function () {
  "use strict";

  const _origFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await _origFetch.apply(this, args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

      // ── REST: submit/ ──────────────────────────────────────────────────────
      // Returns { submission_id } immediately after clicking Submit.
      if (url.includes("/submit/")) {
        const clone = response.clone();
        clone.json().then((data) => {
          const submissionId = data?.submission_id;
          if (!submissionId) return;

          window.postMessage({
            source: "leetflow-injected",
            type: "SUBMIT",
            submissionId: String(submissionId),
          }, "*");
        }).catch(() => {});
      }

      // ── REST: check/ ──────────────────────────────────────────────────────
      // Polled until finished === true. Final response has status_code + status_msg.
      if (url.includes("/check/")) {
        const clone = response.clone();
        clone.json().then((data) => {
          if (!data?.finished) return; // Ignore intermediate polls

          window.postMessage({
            source: "leetflow-injected",
            type: "CHECK",
            submissionId: String(data?.submission_id ?? ""),
            statusCode: data?.status_code,
            statusMsg: data?.status_msg,
            statusRuntime: data?.status_runtime ?? null,
          }, "*");
        }).catch(() => {});
      }

      // ── GraphQL fallback ───────────────────────────────────────────────────
      if (url.includes("/graphql")) {
        const clone = response.clone();
        clone.json().then((data) => {
          window.postMessage({
            source: "leetflow-injected",
            type: "GRAPHQL",
            data,
          }, "*");
        }).catch(() => {});
      }

    } catch (_) {
      // Never throw — this must be invisible to LeetCode
    }

    return response;
  };
})();
