// Tests for extension/auth-bridge.js: runs the real script in a sandbox with
// a fake localStorage, fake timers, and a mocked chrome API.
// Run from the repo root: node --test "tests/**/*.test.mjs"  (Node 22+)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../../extension/auth-bridge.js", import.meta.url), "utf8");
const KEY = "sb-abcdefgh-auth-token";
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

const session = (userId, expiresAt, tag = "") => ({
  access_token: `token-${userId}-${expiresAt}${tag}`,
  refresh_token: `refresh-${userId}-${expiresAt}${tag}`,
  expires_at: expiresAt,
  user: { id: userId },
});

// Loads the bridge on a "dashboard page" whose storage holds `local`, while
// the extension holds `extension`.
async function loadBridge({ local, extension }) {
  const data = new Map(local ? [[KEY, JSON.stringify(local)]] : []);
  data.set("unrelated-key", "x");
  const localStorage = {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
  const sent = [];
  let onMessage = null;
  const intervals = [];
  const win = new EventTarget();
  vm.runInNewContext(code, {
    window: win, localStorage, console,
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
    chrome: {
      runtime: {
        id: "ext",
        sendMessage: async (msg) => {
          sent.push(JSON.parse(JSON.stringify(msg)));
          return msg.type === "GET_SESSION" ? { session: extension ?? null } : { ok: true };
        },
        onMessage: { addListener: (fn) => { onMessage = fn; } },
      },
    },
  });
  await flush();
  return {
    stored: () => (data.has(KEY) ? JSON.parse(data.get(KEY)) : null),
    write: (s) => (s ? data.set(KEY, JSON.stringify(s)) : data.delete(KEY)),
    poll: async () => { intervals.forEach((fn) => fn()); await flush(); },
    push: async (msg) => { onMessage(msg); await flush(); },
    sent,
    forwarded: () => sent.filter((m) => m.type !== "GET_SESSION"),
  };
}

test("on load, a newer extension session for the same user replaces the dashboard's", async () => {
  const b = await loadBridge({ local: session("u1", 1000), extension: session("u1", 2000) });
  assert.equal(b.stored().expires_at, 2000);
  assert.deepEqual(b.forwarded(), [], "nothing to send back — the extension already has it");
});

test("on load, an older extension session is ignored and the dashboard's is forwarded", async () => {
  const b = await loadBridge({ local: session("u1", 2000), extension: session("u1", 1000) });
  assert.equal(b.stored().expires_at, 2000);
  assert.equal(b.forwarded()[0].type, "SET_SESSION");
  assert.equal(b.forwarded()[0].session.expires_at, 2000);
});

test("a different user's extension session is never written into the dashboard", async () => {
  const b = await loadBridge({ local: session("u1", 1000), extension: session("u2", 5000) });
  assert.equal(b.stored().user.id, "u1");
  assert.equal(b.forwarded()[0].session.user.id, "u1");
});

test("a signed-out dashboard is never signed in by the bridge, and clears the extension", async () => {
  const b = await loadBridge({ local: null, extension: session("u1", 5000) });
  assert.equal(b.stored(), null);
  assert.deepEqual(b.forwarded(), [{ type: "CLEAR_SESSION" }]);
});

test("same-tab token refreshes are picked up by polling", async () => {
  const b = await loadBridge({ local: session("u1", 1000), extension: null });
  b.write(session("u1", 3000));
  await b.poll();
  assert.equal(b.forwarded().at(-1).session.expires_at, 3000);
  const count = b.forwarded().length;
  await b.poll(); // unchanged → nothing new sent
  assert.equal(b.forwarded().length, count);
});

test("signing out in the dashboard clears the extension's session", async () => {
  const b = await loadBridge({ local: session("u1", 1000), extension: null });
  b.write(null);
  await b.poll();
  assert.deepEqual(b.forwarded().at(-1), { type: "CLEAR_SESSION" });
});

test("a session the extension refreshed is adopted while the dashboard is open", async () => {
  const b = await loadBridge({ local: session("u1", 1000), extension: null });
  await b.push({ type: "SESSION_UPDATED", session: session("u1", 4000) });
  assert.equal(b.stored().expires_at, 4000);
  await b.push({ type: "SESSION_UPDATED", session: session("u1", 2000) }); // older: ignored
  assert.equal(b.stored().expires_at, 4000);
});
