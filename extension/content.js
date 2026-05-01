/**
 * LeetFlow Content Script
 * Runs on leetcode.com/problems/* pages
 * Silently tracks problem-solving activity with active-time-only measurement.
 */

(function () {
  "use strict";

  // ─── Constants ────────────────────────────────────────────────────────────
  const IDLE_THRESHOLD_MS = 60_000; // 60 s of no interaction → idle
  const SYNC_INTERVAL_MS = 5 * 60_000; // flush locally every 5 min
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
    tickTimer: null,
    idleTimer: null,
  };

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

  // ─── GraphQL interception (passive) ─────────────────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await _origFetch.apply(this, args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (url.includes("/graphql")) {
        const clone = response.clone();
        clone.json().then((data) => {
          handleGraphQLResponse(data);
        }).catch(() => {});
      }
    } catch (_) {
      // Never throw from here
    }

    return response;
  };

  function handleGraphQLResponse(data) {
    // Detect submission result
    try {
      const submission =
        data?.data?.submissionDetails ||
        data?.data?.submitCode ||
        data?.data?.interpret_expected_result;

      if (!submission) return;

      const statusCode = submission.statusCode ?? submission.status_code;
      const runtimeMs = submission.runtimePercentile ?? submission.runtime;
      const submissionId = submission.id ?? submission.submissionId;

      if (statusCode !== undefined) {
        state.attempts += 1;
        sendEvent(EVENTS.SUBMISSION_ATTEMPT, { statusCode, runtimeMs });

        if (statusCode === 10 || submission.statusDisplay === "Accepted") {
          handleAccepted({ submissionId, runtimeMs });
        }
      }
    } catch (_) {}
  }

  // ─── Run Code button detection (DOM-based fallback) ─────────────────────────
  function watchRunButton() {
    const observer = new MutationObserver(() => {
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
    observer.observe(document.body, { childList: true, subtree: true });
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
    chrome.runtime.sendMessage({
      type: "LEETFLOW_EVENT",
      event: type,
      data: { ...buildRecord(), ...extra },
    });
  }

  function flushToBackground({ final = false } = {}) {
    chrome.runtime.sendMessage({
      type: "LEETFLOW_FLUSH",
      data: buildRecord(),
      final,
    });
  }

  // ─── Periodic local flush ───────────────────────────────────────────────────
  setInterval(() => {
    if (state.isTracking) flushToBackground();
  }, SYNC_INTERVAL_MS);

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

  // Guard: only run on problem pages
  if (/\/problems\//.test(window.location.pathname)) {
    // Wait for page to be interactive
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  // ─── Cleanup on navigation ──────────────────────────────────────────────────
  window.addEventListener("beforeunload", () => {
    if (state.isTracking) flushToBackground({ final: true });
    stopTick();
  });

  // ─── Message bridge: popup queries ─────────────────────────────────────────
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
})();
