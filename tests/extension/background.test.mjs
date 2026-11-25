// Tests for extension/background.js, run against mocked chrome APIs and fetch.
// Run from the repo root: node --test "tests/**/*.test.mjs"  (Node 22+)
import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPABASE_URL, DASHBOARD_URL } from "../../extension/config.js";

const EXT_ID = "leetflow-test";
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
const tick = () => new Promise((r) => setTimeout(r, 0));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ─── chrome mock ──────────────────────────────────────────────────────────────
let store = {};
let alarms = {};
let alarmCreates = 0;
let messageListener = null;
let tabMessages = [];
const dashboardTabs = [{ id: 7 }];

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        await tick(); // async like the real API, so operations can interleave
        if (keys === null) return clone(store);
        if (typeof keys === "string") return keys in store ? { [keys]: clone(store[keys]) } : {};
        const out = {};
        for (const [k, def] of Object.entries(keys)) out[k] = k in store ? clone(store[k]) : def;
        return out;
      },
      async set(items) { await tick(); Object.assign(store, clone(items)); },
      async remove(keys) { await tick(); for (const k of [].concat(keys)) delete store[k]; },
    },
  },
  alarms: {
    async get(name) { return alarms[name]; },
    create(name, info) { alarmCreates++; alarms[name] = { name, ...info }; },
    onAlarm: { addListener() {} },
  },
  runtime: {
    id: EXT_ID,
    onMessage: { addListener(fn) { messageListener = fn; } },
    onInstalled: { addListener() {} },
    getManifest: () => ({ content_scripts: [{ matches: [`${DASHBOARD_ORIGIN}/*`], js: ["auth-bridge.js"] }] }),
  },
  tabs: {
    async query() { return dashboardTabs; },
    async sendMessage(tabId, msg) { tabMessages.push({ tabId, msg: clone(msg) }); },
  },
};

// ─── fetch mock ───────────────────────────────────────────────────────────────
let fetchCalls = [];
let holdFetch = null;          // when set, the next REST call waits for release()
let restResponder = () => ({ ok: true, body: "" });
let tokenResponder = () => ({ ok: false, body: "no refresh in this test" });

globalThis.fetch = (url, opts) => {
  const call = { url, body: opts?.body ? JSON.parse(opts.body) : null };
  fetchCalls.push(call);
  const reply = url.includes("/auth/v1/token") ? tokenResponder(call) : restResponder(call);
  const res = { ok: reply.ok, text: async () => reply.body ?? "", json: async () => reply.json };
  if (holdFetch && !url.includes("/auth/")) {
    const h = holdFetch;
    holdFetch = null;
    return new Promise((resolve) => { h.release = () => resolve(res); h.started(); });
  }
  return Promise.resolve(res);
};

function hold() {
  let started;
  const h = { whenStarted: new Promise((r) => (started = r)) };
  h.started = started;
  holdFetch = h;
  return h;
}

function send(msg, sender = { id: EXT_ID }) {
  return new Promise((resolve) => {
    const keepOpen = messageListener(msg, sender, resolve);
    if (keepOpen !== true) setTimeout(() => resolve(undefined), 20);
  });
}

// ─── fixtures ─────────────────────────────────────────────────────────────────
const day = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const record = (over = {}) => ({
  problem_name: "two-sum", problem_title: "1. Two Sum", difficulty: "easy", tags: ["array"], time_taken: 0, attempts: 0,
  status: "in_progress", started_at: "2026-11-25T10:00:00.000Z", completed_at: null,
  session_id: `session_${day()}`, ...over,
});

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
function makeSession({ userId = "user-1", iss = `${SUPABASE_URL}/auth/v1`, expiresIn = 3600, tag = "a" } = {}) {
  return {
    access_token: `${b64url({ alg: "HS256" })}.${b64url({ iss, sub: userId, tag })}.sig`,
    refresh_token: `refresh-${tag}`,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: { id: userId, email: `${userId}@example.com` },
  };
}
const signedIn = () => { store.session = makeSession(); };

function reset() {
  store = {}; fetchCalls = []; tabMessages = []; holdFetch = null;
  restResponder = () => ({ ok: true, body: "" });
  tokenResponder = () => ({ ok: false, body: "no refresh in this test" });
}

// ─── load module ──────────────────────────────────────────────────────────────
const moduleUrl = new URL("../../extension/background.js", import.meta.url).href;
await import(moduleUrl + "?instance=1");
await tick(); await tick();

// ─── alarm ────────────────────────────────────────────────────────────────────
test("creates the periodic alarm once, not on every service-worker wake-up", async () => {
  assert.equal(alarmCreates, 1);
  await import(moduleUrl + "?instance=2");
  await tick(); await tick();
  assert.equal(alarmCreates, 1);
});

// ─── queue merging ────────────────────────────────────────────────────────────
test("merging never moves backwards (accepted stays accepted)", async () => {
  reset();
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ status: "accepted", time_taken: 600, attempts: 2, completed_at: "2026-11-25T10:10:00.000Z" }) });
  await send({ type: "LEETFLOW_FLUSH", final: false, data: record({ time_taken: 300, attempts: 1, started_at: "2026-11-25T11:00:00.000Z", problem_title: null }) });
  const [r] = store.queue;
  assert.equal(store.queue.length, 1);
  assert.deepEqual(
    [r.status, r.time_taken, r.attempts, r.started_at, r.completed_at, r.problem_title],
    ["accepted", 600, 2, "2026-11-25T10:00:00.000Z", "2026-11-25T10:10:00.000Z", "1. Two Sum"]
  );
});

test("failed → in_progress is allowed when the problem is resumed later that day", async () => {
  reset();
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ status: "failed", time_taken: 200 }) });
  await send({ type: "LEETFLOW_EVENT", data: record({ time_taken: 260 }) });
  assert.deepEqual([store.queue.length, store.queue[0].status, store.queue[0].time_taken], [1, "in_progress", 260]);
});

test("a different day is a separate record", async () => {
  reset();
  await send({ type: "LEETFLOW_EVENT", data: record({ time_taken: 200 }) });
  await send({ type: "LEETFLOW_EVENT", data: record({ time_taken: 200, session_id: "session_2026-11-24" }) });
  assert.equal(store.queue.length, 2);
});

test("concurrent messages don't lose each other's writes", async () => {
  reset();
  await Promise.all(["a", "b", "c"].map((name) => send({ type: "LEETFLOW_EVENT", data: record({ problem_name: name, time_taken: 200 }) })));
  assert.deepEqual(store.queue.map((r) => r.problem_name).sort(), ["a", "b", "c"]);
});

// ─── sync ─────────────────────────────────────────────────────────────────────
test("records queued while a sync is in flight are not lost", async () => {
  reset(); signedIn();
  const h = hold();
  const first = send({ type: "LEETFLOW_FLUSH", final: true, data: record({ problem_name: "a", status: "accepted", time_taken: 120, attempts: 1, completed_at: "2026-11-25T10:02:00.000Z" }) });
  await h.whenStarted;
  await send({ type: "LEETFLOW_EVENT", data: record({ problem_name: "b", time_taken: 300 }) });
  h.release();
  await first;
  assert.deepEqual(store.queue.map((r) => r.problem_name), ["b"]);
});

test("a record updated during a sync is kept and sent again", async () => {
  reset(); signedIn();
  await send({ type: "LEETFLOW_FLUSH", final: false, data: record({ problem_name: "a", time_taken: 200 }) });
  const h = hold();
  const syncing = send({ type: "LEETFLOW_FLUSH", final: true, data: record({ problem_name: "z", status: "failed", time_taken: 150 }) });
  await h.whenStarted;
  const update = send({ type: "LEETFLOW_FLUSH", final: true, data: record({ problem_name: "a", status: "accepted", time_taken: 260, attempts: 1, completed_at: "2026-11-25T10:05:00.000Z" }) });
  h.release();
  await Promise.all([syncing, update]);
  assert.equal(store.queue.length, 0);
  const lastA = fetchCalls.filter((c) => c.url.includes("/rest/")).flatMap((c) => c.body).filter((r) => r.problem_name === "a").at(-1);
  assert.deepEqual([lastA.status, lastA.time_taken], ["accepted", 260]);
});

test("payload carries user_id and problem_title, no internal fields", async () => {
  reset(); signedIn();
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ status: "accepted", time_taken: 100 }) });
  const [row] = fetchCalls.find((c) => c.url.includes("/rest/")).body;
  assert.equal(row.user_id, "user-1");
  assert.equal(row.problem_title, "1. Two Sum");
  assert.ok(!("_rev" in row) && !("_queued_at" in row));
});

test("without the problem_title column, sync retries without it", async () => {
  reset(); signedIn();
  restResponder = (call) => call.body.some((r) => "problem_title" in r)
    ? { ok: false, body: JSON.stringify({ code: "PGRST204", message: "Could not find the 'problem_title' column of 'problems' in the schema cache" }) }
    : { ok: true, body: "" };
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ problem_name: "x", status: "accepted", time_taken: 100 }) });
  assert.equal(store.queue.length, 0, "synced on retry");
  const rest = fetchCalls.filter((c) => c.url.includes("/rest/"));
  assert.ok(!("problem_title" in rest.at(-1).body[0]));
});

test("short unsolved records aren't synced and are dropped after a sync", async () => {
  reset(); signedIn();
  await send({ type: "LEETFLOW_EVENT", data: record({ problem_name: "short", time_taken: 99 }) });
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ problem_name: "long", status: "failed", time_taken: 100 }) });
  assert.deepEqual(fetchCalls.find((c) => c.url.includes("/rest/")).body.map((r) => r.problem_name), ["long"]);
  assert.deepEqual(store.queue, []);
});

test("SYNC_NOW reports what's still pending and whether signed in", async () => {
  reset();
  await send({ type: "LEETFLOW_EVENT", data: record({ time_taken: 300 }) });
  assert.deepEqual(await send({ type: "SYNC_NOW" }), { ok: true, pending: 1, signedIn: false });
  signedIn();
  assert.deepEqual(await send({ type: "SYNC_NOW" }), { ok: true, pending: 0, signedIn: true });
});

// ─── session handling ─────────────────────────────────────────────────────────
test("SET_SESSION accepts only sessions from this Supabase project", async () => {
  reset();
  assert.deepEqual(await send({ type: "SET_SESSION", session: makeSession({ iss: "https://other.supabase.co/auth/v1" }) }), { ok: false });
  assert.equal(store.session, undefined);
  assert.deepEqual(await send({ type: "SET_SESSION", session: { access_token: "garbage", user: { id: "user-1" } } }), { ok: false });
  assert.deepEqual(await send({ type: "SET_SESSION", session: makeSession() }), { ok: true });
  assert.equal(store.session.user.id, "user-1");
});

test("SET_SESSION never replaces a newer session with an older one", async () => {
  reset();
  await send({ type: "SET_SESSION", session: makeSession({ expiresIn: 3600, tag: "new" }) });
  assert.deepEqual(await send({ type: "SET_SESSION", session: makeSession({ expiresIn: 600, tag: "old" }) }), { ok: false });
  assert.equal(store.session.refresh_token, "refresh-new");
  // a different user (signed in as someone else) always replaces it
  assert.deepEqual(await send({ type: "SET_SESSION", session: makeSession({ userId: "user-2", expiresIn: 60, tag: "u2" }) }), { ok: true });
  assert.equal(store.session.user.id, "user-2");
});

test("a newly received session syncs records that were waiting", async () => {
  reset();
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ status: "accepted", time_taken: 100 }) });
  assert.equal(store.queue.length, 1, "waits while signed out");
  await send({ type: "SET_SESSION", session: makeSession() });
  await tick(); await tick(); await tick(); await tick();
  await send({ type: "SYNC_NOW" }); // wait for the triggered sync to finish
  assert.equal(store.queue.length, 0);
});

test("GET_SESSION hands tokens only to the dashboard origin", async () => {
  reset(); signedIn();
  assert.deepEqual(await send({ type: "GET_SESSION" }, { id: EXT_ID, origin: "https://leetcode.com" }), { session: null });
  const res = await send({ type: "GET_SESSION" }, { id: EXT_ID, origin: DASHBOARD_ORIGIN });
  assert.equal(res.session.user.id, "user-1");
});

test("an expired token is refreshed, stored, and pushed to open dashboard tabs", async () => {
  reset();
  store.session = makeSession({ expiresIn: 30, tag: "old" });
  const refreshed = makeSession({ tag: "fresh" });
  tokenResponder = (call) => (call.body.refresh_token === "refresh-old" ? { ok: true, json: refreshed } : { ok: false, body: "bad token" });
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ status: "accepted", time_taken: 100 }) });
  assert.equal(store.session.refresh_token, "refresh-fresh");
  assert.deepEqual(tabMessages, [{ tabId: 7, msg: { type: "SESSION_UPDATED", session: refreshed } }]);
  const rest = fetchCalls.find((c) => c.url.includes("/rest/"));
  assert.ok(rest, "synced with the refreshed token");
});

test("a failed refresh keeps the stored session (the dashboard may bring a newer one)", async () => {
  reset();
  store.session = makeSession({ expiresIn: 30, tag: "old" });
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ status: "accepted", time_taken: 100 }) });
  assert.equal(store.session.refresh_token, "refresh-old");
  assert.equal(store.queue.length, 1);
});

test("messages from other extensions are ignored", async () => {
  reset();
  await send({ type: "SET_SESSION", session: makeSession() }, { id: "someone-else" });
  assert.equal(store.session, undefined);
});

// ─── local stats ──────────────────────────────────────────────────────────────
test("stats count each accepted problem once, in local dates", async () => {
  reset();
  await send({ type: "LEETFLOW_EVENT", data: record({ status: "accepted", time_taken: 100 }) });
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ status: "accepted", time_taken: 100 }) });
  const s = await send({ type: "GET_STATS" });
  assert.deepEqual([s.todaySolved, s.totalSolved, s.streak, store.stats.lastSolveDate], [1, 1, 1, day()]);
});

test("GET_STATS resets today's count and a broken streak when read", async () => {
  reset();
  store.stats = { totalSolved: 9, todaySolved: 4, streak: 5, lastSolveDate: day(-3) };
  let s = await send({ type: "GET_STATS" });
  assert.deepEqual([s.todaySolved, s.streak, s.totalSolved], [0, 0, 9]);
  store.stats = { totalSolved: 9, todaySolved: 4, streak: 5, lastSolveDate: day(-1) };
  s = await send({ type: "GET_STATS" });
  assert.deepEqual([s.todaySolved, s.streak], [0, 5]);
});

test("solving yesterday then today extends the streak", async () => {
  reset();
  store.stats = { totalSolved: 3, todaySolved: 2, streak: 2, lastSolveDate: day(-1) };
  await send({ type: "LEETFLOW_FLUSH", final: true, data: record({ problem_name: "n", status: "accepted", time_taken: 100 }) });
  const s = await send({ type: "GET_STATS" });
  assert.deepEqual([s.todaySolved, s.streak, s.totalSolved], [1, 3, 4]);
});
