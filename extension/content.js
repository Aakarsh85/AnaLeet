/**
 * LeetFlow Content Script
 * Injected on every leetcode.com page (LeetCode is a single-page app, so the
 * user can move from the problem list to a problem without a page load) and
 * tracks activity while the URL is a /problems/* page.
 *
 * Measures active time only and produces one record per problem per local
 * calendar day. Progress is saved to chrome.storage.local, so reloading the
 * page or coming back to the problem later the same day continues the same
 * record instead of starting a new one.
 */

(function () {
  "use strict";

  // ─── Constants ────────────────────────────────────────────────────────────
  const IDLE_THRESHOLD_MS   = 1800_000;    // 30 min of no interaction → idle
  const SYNC_INTERVAL_MS    = 5 * 60_000;  // flush locally every 5 min
  // Problems that were never accepted and have less active time than this are
  // discarded. Keep in sync with MIN_TIME_TAKEN_S in background.js.
  const MIN_ACTIVE_MS       = 100_000;
  const PERSIST_INTERVAL_MS = 10_000;      // how often progress is saved for resuming
  const URL_POLL_MS         = 1000;        // how often to check for SPA navigation
  const VISIT_KEY_PREFIX    = "lf_visit_";
  const EVENTS = {
    PROBLEM_OPENED: "problem_opened",
    FIRST_INTERACTION: "first_interaction",
    RUN_CODE: "run_code",
    SUBMISSION_ATTEMPT: "submission_attempt",
    ACCEPTED: "accepted",
  };

  // ─── State ─────────────────────────────────────────────────────────────────
  function initialState() {
    return {
      problemName: "",
      difficulty: "",
      tags: [],
      sessionId: "",
      visitKey: "",        // chrome.storage key holding this problem's progress today
      startedAt: null,
      completedAt: null,   // set once, when the accepted verdict arrives
      activeMs: 0,
      attempts: 0,
      status: "in_progress",
      isTracking: false,   // false before init finishes and after the problem is accepted
      isIdle: false,
      isVisible: document.visibilityState === "visible",
      lastActivityAt: null,
      lastTickAt: null,
      lastPersistAt: 0,
      hasFirstInteraction: false,
      acceptedSubmissionId: null,
      pendingSubmissionId: null, // bridges submit → check / submitCode → submissionDetails
      tickTimer: null,
      idleTimer: null,
    };
  }

  let state = initialState();

  // Tracks the current problem slug so SPA navigation can detect a real change
  let currentSlug = "";
  let lastPath = window.location.pathname;

  // Incremented whenever a visit ends, so an init still waiting on storage can
  // tell that the user has already navigated elsewhere.
  let initToken = 0;

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
  // Returns the problem slug, or "" when the current page isn't a problem.
  function parseProblemSlug() {
    const match = window.location.pathname.match(/\/problems\/([\w-]+)/);
    return match ? match[1] : "";
  }

  // YYYY-MM-DD in the user's local time zone
  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
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

  // ─── Saved progress (resume after reload / revisit) ────────────────────────
  async function loadVisit(key) {
    if (!isContextValid()) return null;
    try {
      const items = await chrome.storage.local.get(key);
      return items?.[key] ?? null;
    } catch (_) {
      return null;
    }
  }

  function persistVisit() {
    if (!state.visitKey || !isContextValid()) return;
    state.lastPersistAt = Date.now();
    try {
      chrome.storage.local
        .set({
          [state.visitKey]: {
            problemName: state.problemName,
            activeMs: state.activeMs,
            attempts: state.attempts,
            status: state.status,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
          },
        })
        .catch(() => {});
    } catch (_) {}
  }

  // Saved progress is only needed for the current day.
  async function pruneOldVisits() {
    if (!isContextValid()) return;
    try {
      const todayPrefix = `${VISIT_KEY_PREFIX}${localDateKey()}_`;
      const all = await chrome.storage.local.get(null);
      const stale = Object.keys(all).filter(
        (k) => k.startsWith(VISIT_KEY_PREFIX) && !k.startsWith(todayPrefix)
      );
      if (stale.length) await chrome.storage.local.remove(stale);
    } catch (_) {}
  }

  // ─── Active-time ticker ─────────────────────────────────────────────────────
  function isCounting() {
    return state.isTracking && !state.isIdle && state.isVisible;
  }

  // Adds the time since the last tick if the user was actively working.
  function accumulate() {
    const now = Date.now();
    if (isCounting() && state.lastTickAt) {
      state.activeMs += now - state.lastTickAt;
    }
    state.lastTickAt = now;
  }

  function startTick() {
    if (state.tickTimer) return;
    state.lastTickAt = Date.now();
    state.tickTimer = setInterval(() => {
      accumulate();
      if (state.isTracking && Date.now() - state.lastPersistAt >= PERSIST_INTERVAL_MS) {
        persistVisit();
      }
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
      accumulate(); // moves lastTickAt forward without counting the idle period
      state.isIdle = false;
    }
    state.idleTimer = setTimeout(() => {
      accumulate();
      state.isIdle = true;
    }, IDLE_THRESHOLD_MS);
  }

  // ─── Visibility handling ────────────────────────────────────────────────────
  document.addEventListener("visibilitychange", () => {
    accumulate(); // count up to the moment the tab was hidden; skip the hidden period
    state.isVisible = document.visibilityState === "visible";
    if (!state.isVisible && state.isTracking) persistVisit();
  });

  // ─── User interaction listeners ─────────────────────────────────────────────
  function onInteraction() {
    if (!state.isTracking) return;
    state.lastActivityAt = Date.now();
    resetIdleTimer();

    if (!state.hasFirstInteraction) {
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
      // Not tracking = not initialised yet, or already accepted (later
      // submissions are not attempts toward solving it).
      if (!submissionId || !state.isTracking) return;

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
      const { submissionId, statusCode, statusMsg } = msg;
      if (!submissionId || state.pendingSubmissionId !== submissionId) return;

      // Always clear pending — terminal result regardless of outcome
      state.pendingSubmissionId = null;

      if (statusCode === 10 || statusMsg === "Accepted") {
        handleAccepted({ submissionId });
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
      const submitCode = data?.data?.submitCode;
      if (submitCode) {
        const submissionId =
          submitCode.submissionId ?? submitCode.submission_id ?? submitCode.id;
        if (!submissionId || !state.isTracking) return;

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
          handleAccepted({ submissionId });
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
  // Accepting a problem finalises its record: the timer stops, the completion
  // time is fixed, and nothing more is added for the rest of the day.
  function handleAccepted({ submissionId }) {
    if (!state.isTracking || state.status === "accepted") return; // Deduplicate

    accumulate(); // count active time right up to the verdict
    stopTick();
    clearTimeout(state.idleTimer);

    state.status = "accepted";
    state.completedAt = new Date().toISOString();
    state.acceptedSubmissionId = submissionId;
    state.isTracking = false;

    persistVisit();
    sendEvent(EVENTS.ACCEPTED);
    flushToBackground({ final: true });
  }

  // ─── Data serialization ─────────────────────────────────────────────────────
  function buildRecord(overrides = {}) {
    return {
      problem_name: state.problemName,
      difficulty: state.difficulty,
      tags: state.tags,
      time_taken: Math.round(state.activeMs / 1000), // seconds
      attempts: state.attempts,
      status: state.status,
      started_at: state.startedAt,
      completed_at: state.completedAt,
      session_id: state.sessionId,
      ...overrides,
    };
  }

  function sendEvent(type) {
    if (!isContextValid()) return;
    try {
      chrome.runtime.sendMessage({
        type: "LEETFLOW_EVENT",
        event: type,
        data: buildRecord(),
      });
    } catch (_) {}
  }

  function flushToBackground({ final = false, status } = {}) {
    if (!isContextValid()) return;
    if (state.isTracking) {
      accumulate();
      persistVisit();
    }
    try {
      chrome.runtime.sendMessage({
        type: "LEETFLOW_FLUSH",
        data: buildRecord(status ? { status } : {}),
        final,
      });
    } catch (_) {}
  }

  // ─── Eligible flush ────────────────────────────────────────────────────────
  // A final flush of a problem that wasn't accepted is recorded as "failed",
  // but only if the user was actively engaged for at least MIN_ACTIVE_MS.
  // Skipping short visits prevents cluttering the dashboard with "failed"
  // records for problems merely glanced at.
  function flushIfEligible({ final = false } = {}) {
    if (final && state.status !== "accepted") {
      accumulate();
      if (state.activeMs < MIN_ACTIVE_MS) {
        persistVisit(); // keep the time in case the user comes back today
        return; // Too short — discard silently
      }
      // Only the synced record says "failed"; the saved progress stays
      // in_progress so a later visit today can still finish it.
      flushToBackground({ final, status: "failed" });
      return;
    }
    flushToBackground({ final });
  }

  // ─── Periodic local flush ───────────────────────────────────────────────────
  setInterval(() => {
    if (state.isTracking && isContextValid()) flushIfEligible();
  }, SYNC_INTERVAL_MS);

  // ─── Ending a visit (navigation away, unload) ──────────────────────────────
  function endVisit() {
    if (state.isTracking) flushIfEligible({ final: true });
    stopTick();
    clearTimeout(state.idleTimer);
    initToken++; // cancels an init that is still loading saved progress
    state = initialState();
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  async function init(slug) {
    const token = ++initToken;
    const day = localDateKey();
    const visitKey = `${VISIT_KEY_PREFIX}${day}_${slug}`;
    const saved = await loadVisit(visitKey);
    if (token !== initToken) return; // user navigated away while loading

    const { title, difficulty, tags } = scrapeProblemMeta();

    // If the title hasn't rendered yet (scrape fell back to the slug), reuse
    // the name saved earlier today so the record keeps the same identity.
    state.problemName = title === slug && saved?.problemName ? saved.problemName : title;
    state.difficulty = difficulty;
    state.tags = tags;
    // One record per problem per local day: matches the database's unique key
    // (user_id, problem_name, session_id).
    state.sessionId = `session_${day}`;
    state.visitKey = visitKey;

    if (saved) {
      state.activeMs = saved.activeMs ?? 0;
      state.attempts = saved.attempts ?? 0;
      state.startedAt = saved.startedAt ?? new Date().toISOString();
      state.completedAt = saved.completedAt ?? null;
      state.status = saved.status === "accepted" ? "accepted" : "in_progress";
    } else {
      state.startedAt = new Date().toISOString();
    }

    // Already accepted earlier today — the record is final, nothing to track.
    if (state.status === "accepted") return;

    state.isTracking = true;
    sendEvent(EVENTS.PROBLEM_OPENED);
    startTick();
    resetIdleTimer();
    watchRunButton();

    // Re-scrape after hydration (React pages may load late, and after SPA
    // navigation the previous problem's title can still be on screen).
    setTimeout(() => {
      if (token !== initToken) return;
      const updated = scrapeProblemMeta();
      if (updated.title !== slug) state.problemName = updated.title;
      if (updated.difficulty !== "unknown") state.difficulty = updated.difficulty;
      if (updated.tags.length) state.tags = updated.tags;
    }, 3000);
  }

  // ─── SPA navigation detection ───────────────────────────────────────────────
  // LeetCode navigates with history.pushState, which a content script can't
  // intercept (it runs in an isolated world, so wrapping history.pushState here
  // doesn't affect the page's own calls). Instead, check the URL periodically
  // and on back/forward navigation.
  function onUrlChange() {
    const path = window.location.pathname;
    if (path === lastPath) return;
    lastPath = path;

    const slug = parseProblemSlug();
    if (slug === currentSlug) return; // Same problem (e.g. Description → Submissions tab)

    // Different problem, or left the problems pages: finish the current visit.
    endVisit();
    currentSlug = slug;
    if (!slug) return;

    // Small delay to let LeetCode's React router finish rendering the new page
    setTimeout(() => {
      if (currentSlug === slug) init(slug);
    }, 800);
  }

  window.addEventListener("popstate", onUrlChange);
  const urlPoll = setInterval(() => {
    if (!isContextValid()) {
      // Extension was reloaded or removed — this copy of the script is orphaned.
      clearInterval(urlPoll);
      stopTick();
      return;
    }
    onUrlChange();
  }, URL_POLL_MS);

  // ─── Initial page load ──────────────────────────────────────────────────────
  pruneOldVisits();
  currentSlug = parseProblemSlug();
  if (currentSlug) {
    const slug = currentSlug;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init(slug));
    } else {
      init(slug);
    }
  }

  // ─── Cleanup on hard unload ─────────────────────────────────────────────────
  window.addEventListener("beforeunload", () => {
    // If already accepted, the final record was sent by handleAccepted.
    if (state.isTracking) flushIfEligible({ final: true });
    stopTick();
  });

  // ─── Message bridge: popup queries ─────────────────────────────────────────
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (msg.type === "GET_CURRENT_SESSION") {
        accumulate();
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
