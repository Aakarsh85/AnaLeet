/**
 * LeetFlow Popup Script
 */

import { DASHBOARD_URL } from "./config.js";

const DEFAULT_DAILY_GOAL = 5;
const GOAL_STORAGE_KEY = "lf_daily_goal";

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const trackingUI = document.getElementById("tracking-ui");
const noProblem = document.getElementById("no-problem");
const settingsPanel = document.getElementById("settings-panel");

const timerMin = document.getElementById("timer-min");
const timerSec = document.getElementById("timer-sec");
const problemNameEl = document.getElementById("problem-name");
const difficultyBadge = document.getElementById("difficulty-badge");
const statusIcon = document.getElementById("status-icon");
const todaySolved = document.getElementById("today-solved");
const progressBar = document.getElementById("progress-bar");
const streakCount = document.getElementById("streak-count");
const streakLabel = document.getElementById("streak-label");
const insightText = document.getElementById("insight-text");
const authStatus = document.getElementById("auth-status");
const openDashboard = document.getElementById("open-dashboard");
const syncBtn = document.getElementById("sync-btn");
const btnHistory = document.getElementById("btn-history");
const btnSettings = document.getElementById("btn-settings");
const backBtn = document.getElementById("back-btn");
const saveSettings = document.getElementById("save-settings");
const dailyGoalInput = document.getElementById("daily-goal-input");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pad(n) {
  return String(Math.floor(n)).padStart(2, "0");
}

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  return { min: pad(Math.floor(totalSec / 60)), sec: pad(totalSec % 60) };
}

function getDailyGoal() {
  const goal = parseInt(localStorage.getItem(GOAL_STORAGE_KEY) || "", 10);
  return goal >= 1 && goal <= 50 ? goal : DEFAULT_DAILY_GOAL;
}

function materialIcon(name, className = "") {
  const span = document.createElement("span");
  span.className = `material-symbols-outlined ${className}`.trim();
  span.textContent = name;
  return span;
}

const TIPS = [
  "Feeling sharp? It's a good time to tackle a Hard problem.",
  "Consistency beats perfection. Keep the streak alive.",
  "Try Array or Sliding Window problems next for quick wins.",
  "Review a problem you solved last week to lock it in.",
  "Take a break after 60 minutes — accuracy stays higher with rest.",
];

// ─── Live session (current LeetCode tab) ──────────────────────────────────────
// Re-read from the content script every second, so the timer shows exactly
// what is being counted (it doesn't advance while idle, hidden or solved).
let liveTimer = null;

function showNoProblem() {
  trackingUI.classList.add("hidden");
  noProblem.classList.remove("hidden");
}

function renderSession(session) {
  trackingUI.classList.remove("hidden");
  noProblem.classList.add("hidden");

  problemNameEl.textContent = session.problemTitle || session.problemName || "–";

  const diff = (session.difficulty || "").toLowerCase();
  difficultyBadge.textContent = session.difficulty || "?";
  difficultyBadge.className = `difficulty-badge ${["easy", "medium", "hard"].includes(diff) ? diff : "unknown"}`;

  const { min, sec } = formatMs(session.activeMs || 0);
  timerMin.textContent = min;
  timerSec.textContent = sec;

  if (session.status === "accepted") {
    statusIcon.replaceChildren(materialIcon("check_circle", "status-icon-symbol accepted"));
  } else if (session.attempts > 0) {
    statusIcon.replaceChildren(materialIcon("pending", "status-icon-symbol attempted"));
  } else {
    statusIcon.replaceChildren(materialIcon("hourglass_empty", "status-icon-symbol"));
  }
}

async function refreshLiveSession() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url?.includes("leetcode.com/problems/")) return showNoProblem();

  try {
    const session = await chrome.tabs.sendMessage(tab.id, { type: "GET_CURRENT_SESSION" });
    if (!session?.problemName) return showNoProblem();
    renderSession(session);
  } catch (_) {
    showNoProblem(); // content script not ready
  }
}

function startLiveUpdates() {
  clearInterval(liveTimer);
  refreshLiveSession();
  liveTimer = setInterval(refreshLiveSession, 1000);
}

function stopLiveUpdates() {
  clearInterval(liveTimer);
  liveTimer = null;
}

// ─── Stats from background ────────────────────────────────────────────────────
async function loadStats() {
  const stats = await chrome.runtime.sendMessage({ type: "GET_STATS" });
  if (!stats) return;

  const goal = getDailyGoal();
  todaySolved.textContent = stats.todaySolved ?? 0;
  progressBar.style.width = `${Math.min(100, ((stats.todaySolved ?? 0) / goal) * 100)}%`;
  streakCount.textContent = stats.streak ?? 0;
  streakLabel.textContent =
    stats.streak > 7
      ? "On fire! 🔥"
      : stats.streak > 3
      ? "Great momentum!"
      : "Keep it up!";

  insightText.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
}

// ─── Auth status ──────────────────────────────────────────────────────────────
async function checkAuth() {
  const { session } = await chrome.storage.local.get({ session: null });
  if (session?.access_token) {
    authStatus.textContent = `✓ Signed in as ${session.user?.email || "user"}`;
    authStatus.className = "auth-status signed-in";
  } else {
    const link = document.createElement("a");
    link.href = DASHBOARD_URL;
    link.target = "_blank";
    link.textContent = "Sign in via Dashboard";
    authStatus.replaceChildren(link, document.createTextNode(" to enable cloud sync."));
    authStatus.className = "auth-status";
  }
}

// ─── Button wiring ────────────────────────────────────────────────────────────
openDashboard.href = DASHBOARD_URL;

btnHistory.addEventListener("click", () => {
  chrome.tabs.create({ url: DASHBOARD_URL });
});

syncBtn.addEventListener("click", async () => {
  const icon = syncBtn.querySelector(".material-symbols-outlined");
  icon.textContent = "sync";
  syncBtn.classList.add("syncing");
  syncBtn.disabled = true;

  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ type: "SYNC_NOW" });
  } catch (_) {}

  syncBtn.classList.remove("syncing");
  syncBtn.disabled = false;

  if (!result?.ok) {
    icon.textContent = "sync_problem";
    syncBtn.title = "Sync failed — try again";
  } else if (!result.signedIn) {
    icon.textContent = "cloud_off";
    syncBtn.title = "Not signed in — open the dashboard and sign in";
  } else if (result.pending > 0) {
    icon.textContent = "cloud_sync";
    syncBtn.title = `${result.pending} record(s) couldn't be synced yet — will retry`;
  } else {
    icon.textContent = "cloud_done";
    syncBtn.title = "Everything is synced";
  }
});

btnSettings.addEventListener("click", () => {
  stopLiveUpdates();
  trackingUI.classList.add("hidden");
  noProblem.classList.add("hidden");
  settingsPanel.classList.remove("hidden");
  checkAuth();
  dailyGoalInput.value = getDailyGoal();
});

backBtn.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
  startLiveUpdates();
  loadStats();
});

saveSettings.addEventListener("click", () => {
  const goal = parseInt(dailyGoalInput.value, 10);
  if (goal >= 1 && goal <= 50) localStorage.setItem(GOAL_STORAGE_KEY, String(goal));
  backBtn.click();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
startLiveUpdates();
loadStats();
