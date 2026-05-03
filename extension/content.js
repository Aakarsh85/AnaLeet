/**
 * LeetFlow Content Script
 * Runs on leetcode.com/problems/* pages
 * Silently tracks problem-solving activity with active-time-only measurement.
 */

(function () {
  "use strict";

  // ─── Constants ────────────────────────────────────────────────────────────
  const IDLE_THRESHOLD_MS = 60_000;    // 60 s of no interaction → idle
  const SYNC_INTERVAL_MS = 5 * 60_000; // flush locally every 5 min
  const MIN_ACTIVE_MS    = 60_000;     // ignore problems opened for less than 1 min
  const EVENTS = {
    PROBLEM_OPENED: "problem_opened",
    FIRST_INTERACTION: "first_interaction",
    RUN_CODE: "run_code",
    SUBMISSION_ATTEMPT: "submission_attempt",
    ACCEPTED: "accepted",
  };

  // ─── State ─────────────────────────────────────────────────────────────────
  let state = {
    problemName: "",
    difficulty: "",
    tags: [],
    sessionId: "",
    startedAt: null,
    activeMs: 0,
    attempts: 0,
    status: "in_progress",
    isTracking: false,
    isIdle: false,
    isVisible: true,
    lastActivityAt: null,
    lastTickAt: null,
    hasFirstInteraction: false,
    acceptedSubmissionId: null,
    pendingSubmissionId: null, // bridges submitCode → submissionDetails
    tickTimer: null,
    idleTimer: null,
  };

  // Tracks the current problem slug so SPA navigation can detect a real change
  let currentSlug = "";

  // Holds the MutationObserver from watchRunButton so it can be disconnected
  // before re-attaching on SPA navigation
  let runButtonObserver = null;

  // ─── Extension context guard ───────────────────────────────────────────────
  // The service worker can be killed at any time (MV3), and reloading the
  // extension orphans any already-injected content script. Every call to
  // chrome.runtime must be guarded or it throws "Extension context invalidated".
  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function parseProblemSlug() {
    const match = window.location.pathname.match(/\/problems\/([\w-]+)/);
    return match ? match[1] : "unknown";
  }

  function scrapeProblemMeta() {
    // Title from breadcrumb / h4 / document title
    const titleEl =
      document.querySelector('[data-cy="question-title"]') ||
      document.querySelector(".mr-2.text-label-1") ||
      document.querySelector("h4");
    const title = titleEl?.textContent?.trim() || parseProblemSlug();

    // Difficulty chip
    const diffEl = document.querySelector(
      '[diff], .text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard, [class*="difficulty"]'
    );
    let difficulty = "unknown";
    if (diffEl) {
      const cls = diffEl.className + " " + (diffEl.textContent || "");
      if (/easy/i.test(cls)) difficulty = "easy";
      else if (/medium/i.test(cls)) difficulty = "medium";
      else if (/hard/i.test(cls)) difficulty = "hard";
    }

    // Tags
    const tagEls = document.querySelectorAll(
      'a[href*="/tag/"], [data-cy="topic-tag"]'
    );
    const tags = Array.from(tagEls)
      .map((el) => el.textContent.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);

    return { title, difficulty, tags };
  }

  function getOrCreateSessionId() {
    // Group by date — simple daily sessions
    const today = new Date().toISOString().slice(0, 10);
    return `session_${today}_${Date.now()}`;
  }

  // ─── Active-time ticker ─────────────────────────────────────────────────────
  function startTick() {
    if (state.tickTimer) return;
    state.lastTickAt = Date.now();
    state.tickTimer = setInterval(() => {
      if (!state.isTracking || state.isIdle || !state.isVisible) return;
      const now = Date.now();
      state.activeMs += now - state.lastTickAt;
      state.lastTickAt = now;
    }, 500);
  }

  function stopTick() {
    clearInterval(state.tickTimer);
    state.tickTimer = null;
  }

  // ─── Idle detection ─────────────────────────────────────────────────────────
  function resetIdleTimer() {
    clearTimeout(state.idleTimer);
    if (state.isIdle) {
      state.isIdle = false;
      state.lastTickAt = Date.now();
    }
    state.idleTimer = setTimeout(() => {
      state.isIdle = true;
    }, IDLE_THRESHOLD_MS);
  }

  // ─── Visibility handling ────────────────────────────────────────────────────
  document.addEventListener("visibilitychange", () => {
    state.isVisible = document.visibilityState === "visible";
    if (state.isVisible) {
      state.lastTickAt = Date.now();
    }
  });

  // ─── User interaction listeners ─────────────────────────────────────────────
  function onInteraction() {
    state.lastActivityAt = Date.now();
    resetIdleTimer();

    if (!state.hasFirstInteraction && state.isTracking) {
      state.hasFirstInteraction = true;
      sendEvent(EVENTS.FIRST_INTERACTION);
    }
  }

  document.addEventListener("keydown", onInteraction, { passive: true });
  document.addEventListener("mousemove", onInteraction, { passive: true });
  document.addEventListener("mousedown", onInteraction, { passive: true });
  document.addEventListener("scroll", onInteraction, { passive: true });

  // ─── postMessage bridge (receives from injected.js MAIN world script) ──────────
  // Content scripts run in an isolated JS world — they cannot intercept LeetCode's
  // fetch. injected.js runs in the MAIN world and forwards events here via postMessage.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "leetflow-injected") return;

    const msg = event.data;

    // ── SUBMIT: capture submission ID, increment attempts ──────────────────
    if (msg.type === "SUBMIT") {
      const submissionId = msg.submissionId;
      if (!submissionId) return;

      state.attempts += 1;
      state.pendingSubmissionId = submissionId;
      sendEvent(EVENTS.SUBMISSION_ATTEMPT);

      // Fallback: clear pending if CHECK never arrives
      const captured = submissionId;
      setTimeout(() => {
        if (state.pendingSubmissionId === captured) {
          state.pendingSubmissionId = null;
        }
      }, 30_000);
    }

    // ── CHECK: terminal result from polling endpoint ────────────────────────
    if (msg.type === "CHECK") {
      const { submissionId, statusCode, statusMsg, statusRuntime } = msg;
      if (!submissionId || state.pendingSubmissionId !== submissionId) return;

      // Always clear pending — terminal result regardless of outcome
      state.pendingSubmissionId = null;

      if (statusCode === 10 || statusMsg === "Accepted") {
        const runtimeMs = statusRuntime ? parseInt(statusRuntime, 10) : null;
        handleAccepted({ submissionId, runtimeMs });
      }
    }

    // ── GRAPHQL: fallback for GraphQL-based submission flows ───────────────
    if (msg.type === "GRAPHQL") {
      handleGraphQLResponse(msg.data);
    }
  });

  function handleGraphQLResponse(data) {
    try {
      // ── Case 1: submitCode ─────────────────────────────────────────────────
      // Shape: { submissionId } only — no status yet.
      // This is the ONLY place we increment attempts.
      const submitCode = data?.data?.submitCode;
      if (submitCode) {
        const submissionId =
          submitCode.submissionId ?? submitCode.submission_id ?? submitCode.id;
        if (!submissionId) return;

        // ✅ Prevent duplicate increments
        if (state.pendingSubmissionId === submissionId) return;

        state.attempts += 1;
        state.pendingSubmissionId = submissionId;
        sendEvent(EVENTS.SUBMISSION_ATTEMPT);

        // Fallback: if submissionDetails never arrives, clear the pending ID
        // so a stale ID cannot match a future response.
        const captured = submissionId;
        setTimeout(() => {
          if (state.pendingSubmissionId === captured) {
            state.pendingSubmissionId = null;
          }
        }, 30_000);

        return;
      }

      // ── Case 2: submissionDetails ──────────────────────────────────────────
      // Shape: { statusCode, statusDisplay, runtimeMs, id, … }
      // This is where the actual result (Accepted / WA / TLE / …) lives.
      const details = data?.data?.submissionDetails;
      if (details) {
        const submissionId = details.submissionId ?? details.id;
        if (!submissionId) return;

        // Only process if it matches the current pending submission
        if (state.pendingSubmissionId !== submissionId) return;

        const statusCode = details.statusCode ?? details.status_code;
        if (statusCode === undefined) return;

        // Always clear pending — terminal result regardless of outcome.
        state.pendingSubmissionId = null;

        if (statusCode === 10 || details.statusDisplay === "Accepted") {
          const runtimeMs = details.runtimeMs ?? details.runtime ?? null;
          handleAccepted({ submissionId, runtimeMs });
        }

        return;
      }

      // ── Case 3: interpret_expected_result ──────────────────────────────────
      // Run Code — not a submission. Ignore entirely.
      if (data?.data?.interpret_expected_result) return;

    } catch (_) {}
  }

  // ─── Run Code button detection (DOM-based fallback) ─────────────────────────
  function watchRunButton() {
    // Disconnect any previous observer before creating a new one.
    // Without this, every SPA navigation stacks another observer.
    if (runButtonObserver) {
      runButtonObserver.disconnect();
      runButtonObserver = null;
    }

    runButtonObserver = new MutationObserver(() => {
      // Stop immediately if the extension context is gone
      if (!isContextValid()) {
        runButtonObserver.disconnect();
        runButtonObserver = null;
        return;
      }

      const runBtn = document.querySelector(
        '[data-e2e-locator="console-run-button"], button[data-cy="run-code-btn"]'
      );
      if (runBtn && !runBtn.__lf_bound) {
        runBtn.__lf_bound = true;
        runBtn.addEventListener("click", () => sendEvent(EVENTS.RUN_CODE), {
          passive: true,
        });
      }
    });

    runButtonObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Accepted flow ──────────────────────────────────────────────────────────
  function handleAccepted({ submissionId, runtimeMs }) {
    if (state.status === "accepted") return; // Deduplicate

    state.status = "accepted";
    state.acceptedSubmissionId = submissionId;

    sendEvent(EVENTS.ACCEPTED);
    flushToBackground({ final: true });
  }

  // ─── Data serialization ─────────────────────────────────────────────────────
  function buildRecord() {
    return {
      problem_name: state.problemName,
      difficulty: state.difficulty,
      tags: state.tags,
      time_taken: Math.round(state.activeMs / 1000), // seconds
      attempts: state.attempts,
      status: state.status,
      started_at: state.startedAt,
      completed_at: state.status === "accepted" ? new Date().toISOString() : null,
      session_id: state.sessionId,
    };
  }

  function sendEvent(type, extra = {}) {
    if (!isContextValid()) return;
    try {
      chrome.runtime.sendMessage({
        type: "LEETFLOW_EVENT",
        event: type,
        data: { ...buildRecord(), ...extra },
      });
    } catch (_) {}
  }

  function flushToBackground({ final = false } = {}) {
    if (!isContextValid()) return;
    try {
      chrome.runtime.sendMessage({
        type: "LEETFLOW_FLUSH",
        data: buildRecord(),
        final,
      });
    } catch (_) {}
  }

  // ─── Eligible flush ────────────────────────────────────────────────────────
  // Only flush non-accepted problems as final if the user was actively engaged
  // for at least MIN_ACTIVE_MS. Skipping short visits prevents cluttering the
  // dashboard with "failed" records for problems merely glanced at.
  function flushIfEligible({ final = false } = {}) {
    if (final && state.status !== "accepted" && state.activeMs < MIN_ACTIVE_MS) {
      return; // Too short — discard silently
    }
    flushToBackground({ final });
  }

  // ─── Periodic local flush ───────────────────────────────────────────────────
  setInterval(() => {
    if (state.isTracking && isContextValid()) flushToBackground();
  }, SYNC_INTERVAL_MS);

  // ─── State reset (called on SPA navigation to a new problem) ───────────────
  function resetState() {
    stopTick();
    clearTimeout(state.idleTimer);

    state.problemName = "";
    state.difficulty = "";
    state.tags = [];
    state.sessionId = "";
    state.startedAt = null;
    state.activeMs = 0;
    state.attempts = 0;
    state.status = "in_progress";
    state.isTracking = false;
    state.isIdle = false;
    state.lastActivityAt = null;
    state.lastTickAt = null;
    state.hasFirstInteraction = false;
    state.acceptedSubmissionId = null;
    state.pendingSubmissionId = null;
    state.tickTimer = null;
    state.idleTimer = null;
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  function init() {
    const { title, difficulty, tags } = scrapeProblemMeta();

    state.problemName = title;
    state.difficulty = difficulty;
    state.tags = tags;
    state.sessionId = getOrCreateSessionId();
    state.startedAt = new Date().toISOString();
    state.isTracking = true;

    sendEvent(EVENTS.PROBLEM_OPENED);
    startTick();
    resetIdleTimer();
    watchRunButton();

    // Re-scrape after hydration (React pages may load late)
    setTimeout(() => {
      const updated = scrapeProblemMeta();
      state.problemName = updated.title;
      state.difficulty = updated.difficulty;
      state.tags = updated.tags;
    }, 3000);
  }

  // ─── SPA navigation detection ───────────────────────────────────────────────
  // LeetCode uses history.pushState — navigating between problems is never a
  // real page load. We intercept pushState and popstate to detect URL changes
  // and re-init tracking when the user lands on a new problem.
  function onUrlChange() {
    const slug = parseProblemSlug();
    const isProblemPage = /\/problems\//.test(window.location.pathname);

    if (!isProblemPage) {
      // Navigated away from problems entirely — flush and stop.
      // If already accepted, stats were counted by handleAccepted — don't re-trigger.
      if (state.isTracking) flushIfEligible({ final: state.status !== "accepted" });
      resetState();
      currentSlug = "";
      return;
    }

    if (slug === currentSlug) return; // Same problem (e.g. tab switch) — do nothing

    // New problem — flush previous session if mid-tracking, then re-init.
    // If already accepted, stats were counted by handleAccepted — don't re-trigger.
    if (state.isTracking) flushIfEligible({ final: state.status !== "accepted" });
    resetState();
    currentSlug = slug;

    // Small delay to let LeetCode's React router finish rendering the new page
    setTimeout(init, 800);
  }

  // Wrap history.pushState to fire our handler
  const _origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    _origPushState(...args);
    onUrlChange();
  };

  const _origReplaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    _origReplaceState(...args);
    onUrlChange();
  };

  // Back / forward navigation
  window.addEventListener("popstate", onUrlChange);

  // ─── Initial page load ──────────────────────────────────────────────────────
  if (/\/problems\//.test(window.location.pathname)) {
    currentSlug = parseProblemSlug();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  // ─── Cleanup on hard unload ─────────────────────────────────────────────────
  window.addEventListener("beforeunload", () => {
    // If already accepted, stats were counted by handleAccepted — don't re-trigger.
    if (state.isTracking) flushIfEligible({ final: state.status !== "accepted" });
    stopTick();
  });

  // ─── Message bridge: popup queries ─────────────────────────────────────────
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (msg.type === "GET_CURRENT_SESSION") {
        respond({
          activeMs: state.activeMs,
          problemName: state.problemName,
          difficulty: state.difficulty,
          isTracking: state.isTracking,
          attempts: state.attempts,
          status: state.status,
        });
      }
      return true;
    });
  } catch (_) {
    // Context already invalidated at registration time — nothing to do
  }
})();