/**
 * LeetFlow Background Service Worker
 * Handles local storage, deduplication, auth session, and Supabase sync.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, DASHBOARD_URL } from "./config.js";

// Records that were never accepted need at least this much active time to be
// synced. Keep in sync with MIN_ACTIVE_MS in content.js.
const MIN_TIME_TAKEN_S = 100;

const EXPECTED_TOKEN_ISSUER = `${SUPABASE_URL}/auth/v1`;
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;

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

async function getStoredSession() {
  const { session } = await chrome.storage.local.get({ session: null });
  return session;
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
const withSessionLock = createMutex();

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
// Mirrors the database's unique key (user_id, problem_name, session_id).
// problem_name is the problem's URL slug and session_id is the local day, so
// solving the same problem several times in one day is a single record.
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
    problem_title: next.problem_title || prev.problem_title || null,
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

// ─── Auth session ─────────────────────────────────────────────────────────────
// The session comes from the dashboard (via auth-bridge.js). Both the
// dashboard and the extension may refresh it, and every refresh rotates the
// refresh token, so the newest session must win on both sides.

function tokenClaims(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
  } catch (_) {
    return null;
  }
}

// Only accept sessions issued by this extension's Supabase project.
function isOurSession(session) {
  if (!session?.access_token || !session?.user?.id) return false;
  const claims = tokenClaims(session.access_token);
  return claims?.iss === EXPECTED_TOKEN_ISSUER && claims?.sub === session.user.id;
}

// Stores the session unless we already hold a newer one for the same user.
function storeSessionIfNewer(session) {
  return withSessionLock(async () => {
    if (!isOurSession(session)) return false;
    const current = await getStoredSession();
    const sameUser = current?.user?.id === session.user.id;
    if (sameUser && (current.expires_at ?? 0) > (session.expires_at ?? 0)) return false;
    if (sameUser && current.access_token === session.access_token) return false;
    await chrome.storage.local.set({ session });
    return true;
  });
}

// Tells open dashboard tabs about a session the extension refreshed itself.
async function broadcastSession(session) {
  try {
    const bridge = chrome.runtime
      .getManifest()
      .content_scripts?.find((cs) => cs.js?.includes("auth-bridge.js"));
    if (!bridge) return;
    const tabs = await chrome.tabs.query({ url: bridge.matches });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "SESSION_UPDATED", session }).catch(() => {});
    }
  } catch (_) {}
}

// Returns true if the session token is expired or expiring within 60s. The
// dashboard refreshes 90s before expiry, so while it's open it usually
// refreshes first and the extension just receives the new session.
function isTokenExpired(session) {
  if (!session?.expires_at) return true;
  return session.expires_at - 60 < Math.floor(Date.now() / 1000);
}

// Returns a valid session, refreshing it with the stored refresh_token if needed.
function getValidSession() {
  return withSessionLock(async () => {
    const session = await getStoredSession();
    if (!session || !isTokenExpired(session)) return session;
    if (!session.refresh_token) return null;

    console.log("[LeetFlow] Token expired — refreshing");
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });

      if (!res.ok) {
        // Keep the stored session: the dashboard may still hand over a newer one.
        console.warn("[LeetFlow] Token refresh failed", await res.text());
        return null;
      }

      const newSession = await res.json();
      await chrome.storage.local.set({ session: newSession });
      broadcastSession(newSession);
      console.log("[LeetFlow] Token refreshed successfully");
      return newSession;
    } catch (err) {
      console.warn("[LeetFlow] Token refresh error", err.message);
      return null;
    }
  });
}

// ─── Supabase sync ────────────────────────────────────────────────────────────
// Set when the database doesn't have the problem_title column yet (schema.sql
// not re-run since it was added): sync without it instead of failing.
let omitProblemTitle = false;

function postProblems(rows, token) {
  return fetch(`${SUPABASE_URL}/rest/v1/problems?on_conflict=user_id,problem_name,session_id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(
      omitProblemTitle ? rows.map(({ problem_title, ...r }) => r) : rows
    ),
  });
}

async function syncOnce() {
  const queue = await getQueue();
  const toSync = queue.filter(isSyncable);
  if (!toSync.length) return;

  const session = await getValidSession();
  const token = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;

  if (!token || !userId) {
    console.warn("[LeetFlow] Not authenticated — skipping sync");
    return;
  }

  const rows = toSync.map(({ _queued_at, _rev, ...r }) => ({ ...r, user_id: userId }));
  try {
    let res = await postProblems(rows, token);
    if (!res.ok) {
      const body = await res.text();
      if (!omitProblemTitle && body.includes("problem_title")) {
        console.warn("[LeetFlow] Database has no problem_title column — re-run supabase/schema.sql");
        omitProblemTitle = true;
        res = await postProblems(rows, token);
        if (!res.ok) {
          console.error("[LeetFlow] Sync failed", await res.text());
          return;
        }
      } else {
        console.error("[LeetFlow] Sync failed", body);
        return;
      }
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
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;

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

  if (msg.type === "SYNC_NOW") {
    (async () => {
      await requestSync();
      const pending = (await getQueue()).filter(isSyncable).length;
      const signedIn = !!(await getStoredSession())?.access_token;
      respond({ ok: true, pending, signedIn });
    })().catch(() => respond({ ok: false }));
    return true;
  }

  if (msg.type === "GET_STATS") {
    getStats().then((s) => respond(currentStats(s)));
    return true;
  }

  if (msg.type === "GET_QUEUE") {
    getQueue().then((q) => respond(q));
    return true;
  }

  // Session handover with the dashboard (auth-bridge.js)
  if (msg.type === "GET_SESSION") {
    // Tokens are only handed to the configured dashboard origin.
    if (sender.origin !== DASHBOARD_ORIGIN) {
      respond({ session: null });
      return;
    }
    getStoredSession().then((session) => respond({ session }));
    return true;
  }

  if (msg.type === "SET_SESSION") {
    storeSessionIfNewer(msg.session).then((stored) => {
      respond({ ok: stored });
      if (stored) requestSync(); // records may be waiting for a valid session
    });
    return true;
  }

  if (msg.type === "CLEAR_SESSION") {
    withSessionLock(() => chrome.storage.local.remove("session")).then(() => respond({ ok: true }));
    return true;
  }
});

// ─── On install ───────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log("[LeetFlow] Extension installed / updated");
});
