/**
 * LeetFlow Background Service Worker
 * Handles local storage, deduplication, and Supabase sync.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Records that were never accepted need at least this much active time to be
// synced. Keep in sync with MIN_ACTIVE_MS in content.js.
const MIN_TIME_TAKEN_S = 100;

// ─── Storage helpers ──────────────────────────────────────────────────────────
async function getQueue() {
  const { queue } = await chrome.storage.local.get({ queue: [] });
  return queue;
}

async function setQueue(queue) {
  await chrome.storage.local.set({ queue });
}

async function getStats() {
  const { stats } = await chrome.storage.local.get({
    stats: { totalSolved: 0, todaySolved: 0, streak: 0, lastSolveDate: null },
  });
  return stats;
}

async function setStats(stats) {
  await chrome.storage.local.set({ stats });
}

// Runs async read-modify-write operations one at a time. Without this, two
// overlapping operations can read the same stored value and the second write
// silently discards the first one's changes.
function createMutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
}

const withQueueLock = createMutex();
const withStatsLock = createMutex();

// YYYY-MM-DD in the user's local time zone
function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateKey(d);
}

// ─── Record identity ──────────────────────────────────────────────────────────
// Mirrors the database's unique key (user_id, problem_name, session_id). The
// content script uses one session_id per local day, so solving the same problem
// several times in one day merges into a single record.
function recordKey(record) {
  return `${record.problem_name}__${record.session_id}`;
}

function isSyncable(record) {
  return record.status === "accepted" || (record.time_taken ?? 0) >= MIN_TIME_TAKEN_S;
}

function earliest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

// Combines two snapshots of the same record without ever going backwards:
// time and attempts only grow, an accepted verdict sticks, and the original
// start time and first completion time are kept.
function mergeRecords(prev, next) {
  const accepted = prev.status === "accepted" || next.status === "accepted";
  return {
    ...prev,
    ...next,
    time_taken: Math.max(prev.time_taken ?? 0, next.time_taken ?? 0),
    attempts: Math.max(prev.attempts ?? 0, next.attempts ?? 0),
    status: accepted ? "accepted" : next.status,
    started_at: earliest(prev.started_at, next.started_at),
    completed_at: accepted ? prev.completed_at ?? next.completed_at ?? null : null,
    difficulty:
      next.difficulty && next.difficulty !== "unknown" ? next.difficulty : prev.difficulty,
    tags: next.tags?.length ? next.tags : prev.tags,
  };
}

// ─── Queue incoming records ───────────────────────────────────────────────────
// Every change bumps the record's _rev so a sync can tell whether a record was
// updated while its request was in flight.
function enqueue(record) {
  return withQueueLock(async () => {
    const queue = await getQueue();
    const key = recordKey(record);
    const idx = queue.findIndex((r) => recordKey(r) === key);

    if (idx >= 0) {
      const prev = queue[idx];
      queue[idx] = { ...mergeRecords(prev, record), _rev: (prev._rev ?? 0) + 1 };
    } else {
      queue.push({ ...record, _queued_at: Date.now(), _rev: 1 });
    }

    await setQueue(queue);
  });
}

// ─── Token refresh ────────────────────────────────────────────────────────────
// Silently refreshes the Supabase session using the stored refresh_token and
// writes the new session back to storage.
async function refreshSession() {
  const { session } = await chrome.storage.local.get({ session: null });
  const refreshToken = session?.refresh_token ?? null;
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      console.warn("[LeetFlow] Token refresh failed", await res.text());
      return null;
    }

    const newSession = await res.json();
    await chrome.storage.local.set({ session: newSession });
    console.log("[LeetFlow] Token refreshed successfully");
    return newSession;
  } catch (err) {
    console.warn("[LeetFlow] Token refresh error", err.message);
    return null;
  }
}

// Returns true if the stored session token is expired or expiring within 60s
function isTokenExpired(session) {
  if (!session?.expires_at) return true;
  return session.expires_at - 60 < Math.floor(Date.now() / 1000);
}

// ─── Supabase sync ────────────────────────────────────────────────────────────
async function syncOnce() {
  const queue = await getQueue();
  const toSync = queue.filter(isSyncable);
  if (!toSync.length) return;

  let { session } = await chrome.storage.local.get({ session: null });

  // Refresh token if expired before attempting sync
  if (isTokenExpired(session)) {
    console.log("[LeetFlow] Token expired — refreshing");
    session = await refreshSession();
  }

  const token = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;

  if (!token || !userId) {
    console.warn("[LeetFlow] Not authenticated — skipping sync");
    return;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/problems?on_conflict=user_id,problem_name,session_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(
        toSync.map(({ _queued_at, _rev, ...r }) => ({ ...r, user_id: userId }))
      ),
    });

    if (!res.ok) {
      console.error("[LeetFlow] Sync failed", await res.text());
      return;
    }
  } catch (err) {
    console.warn("[LeetFlow] Offline — will retry", err.message);
    return;
  }

  // Re-read the queue: records may have been added or updated while the
  // request was in flight. Remove only what was sent unchanged, plus short
  // records that will never qualify for sync.
  const sentRevs = new Map(toSync.map((r) => [recordKey(r), r._rev]));
  await withQueueLock(async () => {
    const current = await getQueue();
    let synced = 0;
    let discarded = 0;
    const remaining = current.filter((r) => {
      if (!isSyncable(r)) {
        discarded++;
        return false;
      }
      const key = recordKey(r);
      if (sentRevs.has(key) && sentRevs.get(key) === r._rev) {
        synced++;
        return false;
      }
      return true;
    });
    await setQueue(remaining);
    console.log(`[LeetFlow] Synced ${synced} records, discarded ${discarded} short records`);
  });
}

// Only one sync runs at a time. Requests that arrive while one is running are
// folded into a single follow-up run, so nothing queued meanwhile is missed.
let syncRunning = null;
let syncAgain = false;

function requestSync() {
  if (syncRunning) {
    syncAgain = true;
    return syncRunning;
  }
  syncRunning = (async () => {
    try {
      do {
        syncAgain = false;
        await syncOnce();
      } while (syncAgain);
    } finally {
      syncRunning = null;
    }
  })();
  return syncRunning;
}

// ─── Local stats ──────────────────────────────────────────────────────────────
function updateStats(record) {
  if (record.status !== "accepted") return Promise.resolve();

  return withStatsLock(async () => {
    const stats = await getStats();
    const today = localDateKey();

    stats.totalSolved = (stats.totalSolved ?? 0) + 1;

    if (stats.lastSolveDate === today) {
      stats.todaySolved = (stats.todaySolved ?? 0) + 1;
    } else {
      stats.streak = stats.lastSolveDate === yesterdayKey() ? (stats.streak ?? 0) + 1 : 1;
      stats.todaySolved = 1;
      stats.lastSolveDate = today;
    }

    await setStats(stats);
  });
}

// Stored counters only change when something is solved, so "today" and the
// streak have to be checked against the current date when they're read.
function currentStats(stats) {
  const solvedToday = stats.lastSolveDate === localDateKey();
  const streakAlive = solvedToday || stats.lastSolveDate === yesterdayKey();
  return {
    ...stats,
    todaySolved: solvedToday ? stats.todaySolved ?? 0 : 0,
    streak: streakAlive ? stats.streak ?? 0 : 0,
  };
}

// ─── Alarm: periodic sync ─────────────────────────────────────────────────────
// Create the alarm only if it doesn't exist: re-creating it every time the
// service worker wakes up would restart the 5-minute countdown, and frequent
// wake-ups could keep pushing the periodic sync back indefinitely.
chrome.alarms.get("periodic-sync").then((alarm) => {
  if (!alarm) chrome.alarms.create("periodic-sync", { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "periodic-sync") {
    await requestSync();
  }
});

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type === "LEETFLOW_FLUSH" || msg.type === "LEETFLOW_EVENT") {
    const record = msg.data;

    (async () => {
      await enqueue(record);

      // Only update stats on the final flush of an accepted submission.
      // LEETFLOW_EVENT messages are informational — counting them would
      // double-increment stats since handleAccepted fires both an event
      // and a final flush.
      if (msg.type === "LEETFLOW_FLUSH" && msg.final && record.status === "accepted") {
        await updateStats(record);
      }

      // Immediate sync on accepted or final flush
      if (record.status === "accepted" || msg.final) {
        await requestSync();
      }

      respond({ ok: true });
    })().catch((err) => {
      console.warn("[LeetFlow] Failed to handle record", err?.message);
      respond({ ok: false });
    });

    return true; // keep message channel open for async respond
  }

  if (msg.type === "GET_STATS") {
    getStats().then((s) => respond(currentStats(s)));
    return true;
  }

  if (msg.type === "GET_QUEUE") {
    getQueue().then((q) => respond(q));
    return true;
  }

  if (msg.type === "SET_SESSION") {
    chrome.storage.local.set({ session: msg.session }).then(() => respond({ ok: true }));
    return true;
  }

  if (msg.type === "CLEAR_SESSION") {
    chrome.storage.local.remove("session").then(() => respond({ ok: true }));
    return true;
  }
});

// ─── On install ───────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log("[LeetFlow] Extension installed / updated");
});
