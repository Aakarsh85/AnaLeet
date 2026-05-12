/**
 * LeetFlow Background Service Worker
 * Handles local storage, deduplication, and Supabase sync.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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

// ─── Deduplication key ────────────────────────────────────────────────────────
// Keyed by problem_name + date so solving the same problem twice in one day
// merges into a single record rather than creating two separate accepted entries.
function dedupKey(record) {
  const date = (record.started_at ?? record.session_id ?? "").slice(0, 10);
  return `${record.problem_name}__${date}`;
}

// ─── Queue incoming records ───────────────────────────────────────────────────
async function enqueue(record) {
  const queue = await getQueue();
  const key = dedupKey(record);
  const idx = queue.findIndex((r) => dedupKey(r) === key);

  if (idx >= 0) {
    // Merge — keep latest active time, attempts, status
    queue[idx] = {
      ...queue[idx],
      ...record,
      time_taken: Math.max(queue[idx].time_taken ?? 0, record.time_taken ?? 0),
      attempts: Math.max(queue[idx].attempts ?? 0, record.attempts ?? 0),
    };
  } else {
    queue.push({ ...record, _queued_at: Date.now() });
  }

  await setQueue(queue);
  return queue;
}

// ─── Supabase sync ────────────────────────────────────────────────────────────
async function getAuthToken() {
  const { session } = await chrome.storage.local.get({ session: null });
  return session?.access_token ?? null;
}

// ─── Token refresh ────────────────────────────────────────────────────────────
// Silently refreshes the Supabase session using the stored refresh_token.
// Writes the new session back to storage so auth-bridge stays in sync.

// isTokenExpired() compares session.expires_at against current Unix time with a 60-second buffer. Supabase tokens expire after 1 hour — your session from yesterday was well past that.
// refreshSession() calls Supabase's standard /auth/v1/token?grant_type=refresh_token endpoint, gets a new session object back, and writes it to storage. The next time auth-bridge reads localStorage on the dashboard, it'll pick up the refreshed token too.
// syncToSupabase() now checks expiry first and refreshes before attempting the fetch — so sync never silently fails due to a stale token again.

// add token expiry check before syncing, and if expired, attempt a refresh using the refresh_token before bailing
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

async function syncToSupabase() {
  const queue = await getQueue();
  if (!queue.length) return;

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

  const MIN_TIME_TAKEN_S = 60; // mirror content.js MIN_ACTIVE_MS in seconds

  const toSync = queue.filter((r) =>  r.status === "accepted" ||  (r._queued_at && (r.time_taken ?? 0) >= MIN_TIME_TAKEN_S));
  // const toSync = queue.filter((r) => r.status === "accepted" || r._queued_at);
  if (!toSync.length) return;

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
        toSync.map(({ _queued_at, ...r }) => ({ ...r, user_id: userId }))
      ),
    });

    // if (res.ok) {
    //   // Remove synced items from queue
    //   const remaining = queue.filter((r) => !toSync.includes(r));
    //   await setQueue(remaining);
    //   console.log(`[LeetFlow] Synced ${toSync.length} records`);
    // } 
    if (res.ok) {
      // Remove synced items from queue
      const toDrain = queue.filter((r) => r.status !== "accepted" && (r.time_taken ?? 0) < MIN_TIME_TAKEN_S);
      const remaining = queue.filter((r) => !toSync.includes(r) && !toDrain.includes(r));
      await setQueue(remaining);
      console.log(`[LeetFlow] Synced ${toSync.length} records, discarded ${toDrain.length} short records`);
    } else {
      console.error("[LeetFlow] Sync failed", await res.text());
    }
  } catch (err) {
    console.warn("[LeetFlow] Offline — will retry", err.message);
  }
}

// ─── Update local stats ───────────────────────────────────────────────────────
async function updateStats(record) {
  if (record.status !== "accepted") return;

  const stats = await getStats();
  const today = new Date().toISOString().slice(0, 10);

  stats.totalSolved = (stats.totalSolved ?? 0) + 1;

  if (stats.lastSolveDate === today) {
    stats.todaySolved = (stats.todaySolved ?? 0) + 1;
  } else {
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    stats.streak =
      stats.lastSolveDate === yesterday ? (stats.streak ?? 0) + 1 : 1;
    stats.todaySolved = 1;
    stats.lastSolveDate = today;
  }

  await setStats(stats);
}

// ─── Alarm: periodic sync ─────────────────────────────────────────────────────
chrome.alarms.create("periodic-sync", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "periodic-sync") {
    await syncToSupabase();
  }
});

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type === "LEETFLOW_FLUSH" || msg.type === "LEETFLOW_EVENT") {
    const record = msg.data;

    enqueue(record).then(async () => {
      // Before, updateStats fired on every message with status: "accepted". handleAccepted in content.js sends two messages — LEETFLOW_EVENT with the accepted event, then LEETFLOW_FLUSH with final: true. Both had status: "accepted", so stats incremented twice per solve.
      // Now it only fires when msg.type === "LEETFLOW_FLUSH" && msg.final && record.status === "accepted" — exactly once per accepted submission.

      // Only update stats on the final flush of an accepted submission.
      // LEETFLOW_EVENT messages are informational — counting them would
      // double-increment stats since handleAccepted fires both an event
      // and a final flush.
      if (msg.type === "LEETFLOW_FLUSH" && msg.final && record.status === "accepted") {
        await updateStats(record);
      }

      // Immediate sync on accepted or final flush
      if (record.status === "accepted" || msg.final) {
        await syncToSupabase();
      }

      respond({ ok: true });
    });

    return true; // keep message channel open for async respond
  }

  if (msg.type === "GET_STATS") {
    getStats().then((s) => respond(s));
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