// Tests for extension/content.js: runs the real script in a sandbox with a
// fake clock, a fake LeetCode page, and a mocked chrome API.
// Run from the repo root: node --test "tests/**/*.test.mjs"  (Node 22+)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../../extension/content.js", import.meta.url), "utf8");

// ─── fake clock + timers (shared by all page instances) ───────────────────────
const RealDate = Date;
let clock = new RealDate(2026, 10, 25, 10, 0, 0).getTime(); // local 10:00
class FakeDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(clock); else super(...args); }
  static now() { return clock; }
}
let timers = [];
let nextTimerId = 1;
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
function timerApi(owner) {
  const add = (fn, ms, repeat) => { const id = nextTimerId++; timers.push({ id, owner, at: clock + (ms || 0), ms: ms || 0, fn, repeat }); return id; };
  const clear = (id) => { timers = timers.filter((t) => t.id !== id); };
  return { setTimeout: (fn, ms) => add(fn, ms, false), setInterval: (fn, ms) => add(fn, ms, true), clearTimeout: clear, clearInterval: clear };
}
async function advance(ms) {
  const target = clock + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const t = timers[0];
    if (!t || t.at > target) break;
    clock = t.at;
    if (t.repeat) t.at += t.ms; else timers.shift();
    t.fn();
    await flush();
  }
  clock = target;
  await flush();
}

// ─── shared chrome.storage + message log ──────────────────────────────────────
let store = {};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const storage = {
  async get(keys) {
    if (keys === null) return clone(store);
    if (typeof keys === "string") return keys in store ? { [keys]: clone(store[keys]) } : {};
    return {};
  },
  async set(items) { Object.assign(store, clone(items)); },
  async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
};
let sent = [];

// ─── one LeetCode tab running content.js ──────────────────────────────────────
// `page` describes what's rendered: the URL path, and which problem's title
// link / difficulty / tags are on screen (they can lag behind the URL).
let pageCount = 0;
function openPage(page) {
  const owner = ++pageCount;
  const dom = { difficulty: "easy", tags: ["Array"], ...page };
  const win = new EventTarget();
  win.location = { get pathname() { return dom.path; } };
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  doc.readyState = "complete";
  doc.body = {};
  doc.querySelector = (sel) => {
    const link = sel.match(/^a\[href="\/problems\/([\w-]+)\/"\]$/);
    if (link) return dom.titleSlug === link[1] && dom.title ? { textContent: dom.title } : null;
    if (sel.includes("difficulty") && dom.difficulty) return { className: `text-difficulty-${dom.difficulty}`, textContent: dom.difficulty };
    return null;
  };
  doc.querySelectorAll = () => (dom.tags || []).map((t) => ({ textContent: t }));
  let popupListener = null;
  const sandbox = {
    window: win, document: doc, Date: FakeDate, console,
    MutationObserver: class { observe() {} disconnect() {} },
    chrome: {
      runtime: {
        id: "ext",
        sendMessage: (msg) => { sent.push(clone(msg)); return Promise.resolve(); },
        onMessage: { addListener: (fn) => { popupListener = fn; } },
      },
      storage: { local: storage },
    },
    ...timerApi(owner),
  };
  vm.runInNewContext(code, sandbox);

  const tab = {
    render(next) { Object.assign(dom, next); },
    interact() { doc.dispatchEvent(new Event("keydown")); },
    setVisible(v) { doc.visibilityState = v ? "visible" : "hidden"; doc.dispatchEvent(new Event("visibilitychange")); },
    post(data) {
      const ev = new Event("message");
      Object.defineProperty(ev, "data", { value: { source: "leetflow-injected", ...data } });
      Object.defineProperty(ev, "source", { value: win });
      win.dispatchEvent(ev);
    },
    submit(id, accepted) {
      tab.post({ type: "SUBMIT", submissionId: id });
      tab.post({ type: "CHECK", submissionId: id, statusCode: accepted ? 10 : 11, statusMsg: accepted ? "Accepted" : "Wrong Answer" });
    },
    popup() { let out; popupListener({ type: "GET_CURRENT_SESSION" }, {}, (r) => { out = r; }); return out; },
    seconds() { return Math.round(tab.popup().activeMs / 1000); },
    close() { win.dispatchEvent(new Event("beforeunload")); timers = timers.filter((t) => t.owner !== owner); },
  };
  return tab;
}

const today = "2026-11-25";
const messages = (filter = {}) => sent.filter((m) => Object.entries(filter).every(([k, v]) => (k in m ? m[k] === v : m.data?.[k] === v)));
const problem = (slug, title, extra = {}) => ({ path: `/problems/${slug}/description/`, titleSlug: slug, title, ...extra });

// ─── scenarios (run in order; they share one tab) ─────────────────────────────
const tab = openPage(problem("two-sum", "1. Two Sum"));
await flush();

test("opening a problem starts a per-day record keyed by slug", () => {
  const m = messages({ event: "problem_opened" })[0];
  assert.ok(m, "no problem_opened event");
  assert.equal(m.data.problem_name, "two-sum");
  assert.equal(m.data.problem_title, "1. Two Sum");
  assert.equal(m.data.difficulty, "easy");
  assert.deepEqual(m.data.tags, ["array"]);
  assert.equal(m.data.session_id, `session_${today}`);
  assert.equal(m.data.time_taken, 0);
});

test("active time accumulates while visible", async () => {
  tab.interact();
  await advance(120_000);
  assert.equal(tab.seconds(), 120);
});

test("time while the tab is hidden is not counted", async () => {
  tab.setVisible(false);
  await advance(60_000);
  tab.setVisible(true);
  assert.equal(tab.seconds(), 120);
});

test("an accepted submission sends one final record with the time at acceptance", async () => {
  tab.submit("s1", false);
  await advance(30_000);
  sent = [];
  tab.submit("s2", true);
  await flush();
  const final = messages({ type: "LEETFLOW_FLUSH", final: true });
  assert.equal(final.length, 1);
  assert.deepEqual([final[0].data.status, final[0].data.attempts, final[0].data.time_taken], ["accepted", 2, 150]);
  assert.ok(final[0].data.completed_at);
});

test("after acceptance: timer stops, nothing more is sent, later submits aren't attempts", async () => {
  const completedAt = messages({ type: "LEETFLOW_FLUSH", final: true })[0].data.completed_at;
  sent = [];
  tab.interact();
  await advance(11 * 60_000);
  tab.submit("s3", true);
  await flush();
  assert.equal(sent.length, 0, `unexpected: ${JSON.stringify(sent.map((m) => m.event || m.type))}`);
  const s = tab.popup();
  assert.deepEqual([Math.round(s.activeMs / 1000), s.attempts, s.isTracking], [150, 2, false]);
  assert.equal(store[`lf_visit_${today}_two-sum`].completedAt, completedAt);
});

test("SPA navigation is detected, and the previous problem's title is never reused", async () => {
  sent = [];
  // URL changes first; the old problem's title link is still on screen
  tab.render({ path: "/problems/add-two-numbers/description/" });
  await advance(2500);
  const opened = messages({ event: "problem_opened" });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].data.problem_name, "add-two-numbers");
  assert.equal(opened[0].data.problem_title, null);
  // the new page finishes rendering
  tab.render({ titleSlug: "add-two-numbers", title: "2. Add Two Numbers", difficulty: "medium" });
  await advance(3000);
  assert.equal(tab.popup().problemTitle, "2. Add Two Numbers");
  assert.equal(tab.popup().difficulty, "medium");
});

test("switching tabs within a problem is not a new problem", async () => {
  sent = [];
  tab.render({ path: "/problems/add-two-numbers/submissions/" });
  await advance(3000);
  assert.equal(messages({ event: "problem_opened" }).length, 0);
});

test("time away from the keyboard for 30+ minutes is not counted", async () => {
  tab.interact();
  const before = tab.seconds();
  await advance(40 * 60_000);   // away for 40 minutes
  tab.interact();
  assert.equal(tab.seconds(), before);
});

test("thinking without input for under 30 minutes is counted", async () => {
  tab.interact();
  const before = tab.seconds();
  await advance(20 * 60_000);
  tab.interact();
  assert.equal(tab.seconds(), before + 20 * 60);
});

test("leaving an unsolved problem after enough time records it as failed", async () => {
  const time = tab.seconds();
  sent = [];
  tab.render({ path: "/problemset/", titleSlug: null, title: null });
  await advance(1500);
  const final = messages({ type: "LEETFLOW_FLUSH", final: true });
  assert.equal(final.length, 1);
  assert.equal(final[0].data.status, "failed");
  assert.equal(final[0].data.problem_title, "2. Add Two Numbers");
  assert.ok(Math.abs(final[0].data.time_taken - time) <= 2);
  assert.equal(store[`lf_visit_${today}_add-two-numbers`].status, "in_progress", "saved progress stays resumable");
});

test("coming back the same day resumes the same record", async () => {
  sent = [];
  tab.render(problem("add-two-numbers", "2. Add Two Numbers"));
  await advance(2000);
  const opened = messages({ event: "problem_opened" })[0];
  assert.equal(opened.data.status, "in_progress");
  assert.equal(opened.data.session_id, `session_${today}`);
  assert.ok(opened.data.time_taken >= 20 * 60, `resumed time ${opened.data.time_taken}`);
});

test("reopening a problem already accepted today doesn't track or send anything", async () => {
  sent = [];
  tab.render(problem("two-sum", "1. Two Sum"));
  await advance(5000);
  tab.interact();
  await advance(6 * 60_000);
  assert.equal(sent.filter((m) => m.data?.problem_name === "two-sum").length, 0);
  assert.equal(tab.popup().status, "accepted");
  assert.equal(tab.seconds(), 150);
});

test("a short visit to an unsolved problem is discarded", async () => {
  tab.render(problem("short-one", "3. Short One"));
  await advance(2000);
  tab.interact();
  await advance(30_000);
  sent = [];
  tab.render({ path: "/problemset/", titleSlug: null, title: null });
  await advance(1500);
  assert.equal(messages({ final: true }).length, 0);
});

test("missing metadata is filled in before a record is sent", async () => {
  tab.render(problem("late-render", "", { difficulty: null, tags: [] }));
  await advance(2000);
  assert.equal(tab.popup().difficulty, "unknown");
  tab.render({ title: "6. Late Render", difficulty: "hard", tags: ["Graph"] });
  tab.interact();
  sent = [];
  await advance(5 * 60_000 + 1000); // periodic flush
  const periodic = messages({ type: "LEETFLOW_FLUSH", final: false }).at(-1);
  assert.deepEqual([periodic.data.problem_title, periodic.data.difficulty, periodic.data.tags], ["6. Late Render", "hard", ["graph"]]);
  assert.equal(periodic.data.status, "in_progress");
});

test("reloading the page continues the day's time instead of starting over", async () => {
  tab.render(problem("reload-me", "4. Reload Me"));
  await advance(2000);
  tab.interact();
  await advance(200_000);
  tab.interact();
  tab.close();
  await flush();
  sent = [];
  const reloaded = openPage(problem("reload-me", "4. Reload Me"));
  await flush();
  const opened = messages({ event: "problem_opened" })[0];
  assert.ok(opened.data.time_taken >= 200, `time after reload ${opened.data.time_taken}`);
  reloaded.interact();
  await advance(60_000);
  assert.ok(reloaded.seconds() >= 260);
  reloaded.close();
});

test("progress from previous days is pruned on load", async () => {
  store["lf_visit_2026-11-20_old"] = { activeMs: 1 };
  const p = openPage({ path: "/problemset/" });
  await flush();
  assert.ok(!("lf_visit_2026-11-20_old" in store));
  assert.ok(`lf_visit_${today}_two-sum` in store);
  p.close();
});
