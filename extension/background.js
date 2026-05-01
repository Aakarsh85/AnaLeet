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
function dedupKey(record) {
  return `${record.problem_name}__${record.session_id}`;
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

async function syncToSupabase() {
  const queue = await getQueue();
  if (!queue.length) return;

  const token = await getAuthToken();
  if (!token) {
    console.warn("[LeetFlow] Not authenticated — skipping sync");
    return;
  }

  const toSync = queue.filter((r) => r.status === "accepted" || r._queued_at);
  if (!toSync.length) return;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/problems`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(
        toSync.map(({ _queued_at, ...r }) => r)
      ),
    });

    if (res.ok) {
      // Remove synced items from queue
      const remaining = queue.filter((r) => !toSync.includes(r));
      await setQueue(remaining);
      console.log(`[LeetFlow] Synced ${toSync.length} records`);
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
      await updateStats(record);

      // Immediate sync on accepted
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
