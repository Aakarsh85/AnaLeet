/**
 * LeetFlow Popup Script
 */

const DASHBOARD_URL = "https://ana-leet.vercel.app/"; // Change to deployed URL when live
const DAILY_GOAL = 5;

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

function difficultyStyle(diff) {
  const d = (diff || "").toLowerCase();
  if (d === "easy") return { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" };
  if (d === "medium") return { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" };
  if (d === "hard") return { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" };
  return { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/20" };
}

const INSIGHTS = [
  "You're on a roll! Best time to tackle a Hard problem.",
  "Consistency beats perfection. Keep the streak alive.",
  "Try Array or Sliding Window problems next for quick wins.",
  "Your average solve time improves every week. 🚀",
  "Break after 60 min — your accuracy stays higher with rest.",
];

// ─── Live timer (polls active tab content script every second) ────────────────
let sessionMs = 0;
let timerInterval = null;

function startPopupTimer(initialMs) {
  sessionMs = initialMs;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    sessionMs += 1000;
    const { min, sec } = formatMs(sessionMs);
    timerMin.textContent = min;
    timerSec.textContent = sec;
  }, 1000);
}

async function queryActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url?.includes("leetcode.com/problems/")) {
    trackingUI.classList.add("hidden");
    noProblem.classList.remove("hidden");
    return;
  }

  try {
    const session = await chrome.tabs.sendMessage(tab.id, {
      type: "GET_CURRENT_SESSION",
    });

    if (!session) return;

    trackingUI.classList.remove("hidden");
    noProblem.classList.add("hidden");

    // Problem name
    problemNameEl.textContent = session.problemName || "–";

    // Difficulty badge
    const style = difficultyStyle(session.difficulty);
    difficultyBadge.textContent = session.difficulty || "?";
    difficultyBadge.className = `px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-tighter border shrink-0 ${style.bg} ${style.text} ${style.border}`;

    // Timer
    startPopupTimer(session.activeMs || 0);

    // Status icon
    if (session.status === "accepted") {
      statusIcon.innerHTML = `<span class="material-symbols-outlined text-sm text-emerald-400" style="font-variation-settings:'FILL' 1;">check_circle</span>`;
    } else if (session.attempts > 0) {
      statusIcon.innerHTML = `<span class="material-symbols-outlined text-sm text-amber-400">pending</span>`;
    }
  } catch (_) {
    // Content script not ready
    trackingUI.classList.add("hidden");
    noProblem.classList.remove("hidden");
  }
}

// ─── Stats from background ────────────────────────────────────────────────────
async function loadStats() {
  const stats = await chrome.runtime.sendMessage({ type: "GET_STATS" });
  if (!stats) return;

  const goal = parseInt(localStorage.getItem("lf_daily_goal") || "5", 10);
  todaySolved.textContent = stats.todaySolved ?? 0;
  progressBar.style.width = `${Math.min(100, ((stats.todaySolved ?? 0) / goal) * 100)}%`;
  streakCount.textContent = stats.streak ?? 0;
  streakLabel.textContent =
    stats.streak > 7
      ? "On fire! 🔥"
      : stats.streak > 3
      ? "Great momentum!"
      : "Keep it up!";

  insightText.innerHTML = INSIGHTS[Math.floor(Math.random() * INSIGHTS.length)];
}

// ─── Auth status ──────────────────────────────────────────────────────────────
async function checkAuth() {
  const { session } = await chrome.storage.local.get({ session: null });
  if (session?.access_token) {
    authStatus.textContent = `✓ Signed in as ${session.user?.email || "user"}`;
    authStatus.className = "text-sm text-emerald-400";
  } else {
    authStatus.innerHTML = `<a href="${DASHBOARD_URL}" target="_blank" class="text-primary underline">Sign in via Dashboard</a> to enable cloud sync.`;
  }
}

// ─── Button wiring ────────────────────────────────────────────────────────────
openDashboard.href = DASHBOARD_URL;

syncBtn.addEventListener("click", async () => {
  syncBtn.querySelector(".material-symbols-outlined").textContent = "sync";
  syncBtn.querySelector(".material-symbols-outlined").classList.add("animate-spin");
  await chrome.runtime.sendMessage({ type: "GET_STATS" }); // prod: would trigger sync
  setTimeout(() => {
    syncBtn.querySelector(".material-symbols-outlined").classList.remove("animate-spin");
  }, 1000);
});

btnSettings.addEventListener("click", () => {
  trackingUI.classList.add("hidden");
  noProblem.classList.add("hidden");
  settingsPanel.classList.remove("hidden");
  checkAuth();
  const goal = localStorage.getItem("lf_daily_goal") || "5";
  dailyGoalInput.value = goal;
});

backBtn.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
  queryActiveTab();
  loadStats();
});

saveSettings.addEventListener("click", () => {
  localStorage.setItem("lf_daily_goal", dailyGoalInput.value);
  backBtn.click();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
queryActiveTab();
loadStats();
