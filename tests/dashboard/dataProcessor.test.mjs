// Tests for dashboard/src/lib/dataProcessor.js.
// Run from the repo root: node --test "tests/**/*.test.mjs"  (Node 22+)
// Uses the viewer's local time zone, like the dashboard; try e.g. TZ=Asia/Kolkata.
import { test } from "node:test";
import assert from "node:assert/strict";

// supabase.js logs a config error when the Vite env vars are absent; silence it.
const originalError = console.error;
console.error = () => {};
const dp = await import("../../dashboard/src/lib/dataProcessor.js");
console.error = originalError;

const {
  localDateKey, calcStreak, buildHeatmapData, groupByDate, effectiveStatus,
  buildAttemptEfficiencyTrend, buildDifficultyProgressionData, buildSessionData, fetchProblems,
  problemTitle, solvedProblems, buildDifficultyData, problemsToCsv, generateInsights,
} = dp;

// Local-time fixture helpers
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const acc = (iso, extra = {}) => ({ status: "accepted", started_at: iso, attempts: 1, difficulty: "easy", problem_name: "two-sum", ...extra });
const today = new Date(2026, 10, 25, 15, 0); // Wed Nov 25 2026, 15:00 local

test("localDateKey uses the local date, not the UTC date", () => {
  assert.equal(localDateKey(at(2026, 11, 25, 0, 30)), "2026-11-25");
  assert.equal(localDateKey(at(2026, 11, 25, 23, 30)), "2026-11-25");
  assert.equal(localDateKey(null), null);
});

test("groupByDate buckets by local date", () => {
  assert.deepEqual(groupByDate([acc(at(2026, 11, 25, 0, 30)), acc(at(2026, 11, 25, 23, 30))]), { "2026-11-25": 2 });
});

test("streak: consecutive days ending today", () => {
  const p = [acc(at(2026, 11, 25)), acc(at(2026, 11, 24)), acc(at(2026, 11, 23))];
  assert.equal(calcStreak(p, today), 3);
});

test("streak: a missed day ends it", () => {
  const p = [acc(at(2026, 11, 25)), acc(at(2026, 11, 23)), acc(at(2026, 11, 22))];
  assert.equal(calcStreak(p, today), 1);
});

test("streak: ending yesterday still counts; two days ago doesn't", () => {
  assert.equal(calcStreak([acc(at(2026, 11, 24)), acc(at(2026, 11, 23))], today), 2);
  assert.equal(calcStreak([acc(at(2026, 11, 23))], today), 0);
});

test("streak: only accepted rows count, by local day", () => {
  assert.equal(calcStreak([{ status: "failed", started_at: at(2026, 11, 25) }], today), 0);
  assert.equal(calcStreak([acc(at(2026, 11, 25, 0, 30)), acc(at(2026, 11, 24, 23, 45))], today), 2);
});

test("heatmap: Sunday-aligned weeks ending today", () => {
  const days = buildHeatmapData([acc(at(2026, 11, 25, 0, 30))], today);
  for (let i = 0; i < days.length; i += 7) {
    assert.equal(new Date(`${days[i].date}T00:00:00`).getDay(), 0, `${days[i].date} is not a Sunday`);
  }
  assert.equal(days.at(-1).date, "2026-11-25");
  assert.equal(days.at(-1).count, 1);
  assert.ok(days.length >= 365 && days.length <= 371);
});

test("weekly charts: 8 most recent weeks, oldest → newest", () => {
  const p = [];
  for (let w = 0; w < 10; w++) p.push(acc(new Date(2026, 10, 25 - 7 * w, 12).toISOString(), { attempts: w % 2 ? 2 : 1 }));
  const trend = buildAttemptEfficiencyTrend(p);
  assert.equal(trend.length, 8);
  assert.equal(trend[0].week, "Oct 5");
  assert.equal(trend.at(-1).week, "Nov 23");
  assert.deepEqual(buildDifficultyProgressionData(p).map((w) => w.week), trend.map((w) => w.week));
});

test("weekly charts: weeks from different years stay separate and ordered", () => {
  const trend = buildAttemptEfficiencyTrend([acc(new Date(2026, 0, 6, 12).toISOString()), acc(new Date(2025, 0, 7, 12).toISOString())]);
  assert.deepEqual(trend.map((w) => w.week), ["Jan 6", "Jan 5"]);
});

test("session timeline groups by local date", () => {
  const s = buildSessionData([acc(at(2026, 11, 25, 0, 30), { time_taken: 600 }), acc(at(2026, 11, 25, 23, 0), { time_taken: 600 })]);
  assert.deepEqual(s, [{ date: "2026-11-25", duration: 20, problems: 2 }]);
});

test("effectiveStatus treats stale in_progress rows as failed", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  assert.equal(effectiveStatus({ status: "accepted" }, now), "accepted");
  assert.equal(effectiveStatus({ status: "failed" }, now), "failed");
  assert.equal(effectiveStatus({ status: "in_progress", updated_at: "2026-11-25T11:50:00Z" }, now), "in_progress");
  assert.equal(effectiveStatus({ status: "in_progress", updated_at: "2026-11-25T10:00:00Z" }, now), "failed");
  assert.equal(effectiveStatus({ status: "in_progress" }, now), "failed");
});

test("problemTitle prefers the stored title, else derives one from the slug", () => {
  assert.equal(problemTitle({ problem_name: "two-sum", problem_title: "1. Two Sum" }), "1. Two Sum");
  assert.equal(problemTitle({ problem_name: "palindrome-number" }), "Palindrome Number");
  assert.equal(problemTitle({ problem_name: "two-sum-ii-input-array-is-sorted" }), "Two Sum II Input Array Is Sorted");
  assert.equal(problemTitle({ problem_name: "Some Old Title" }), "Some Old Title");
});

test("solved counts are per distinct problem, not per day", () => {
  const p = [
    acc(at(2026, 11, 20), { problem_name: "two-sum" }),
    acc(at(2026, 11, 21), { problem_name: "two-sum" }),
    acc(at(2026, 11, 21), { problem_name: "lru-cache", difficulty: "medium" }),
    { status: "failed", problem_name: "n-queens", difficulty: "hard", started_at: at(2026, 11, 22) },
  ];
  assert.equal(solvedProblems(p).length, 2);
  assert.deepEqual(buildDifficultyData(p).map((d) => d.count), [1, 1, 0]);
});

test("insights are structured parts, never HTML", () => {
  const p = [acc(at(2026, 11, 25), { tags: ["<img src=x onerror=alert(1)>"], time_taken: 600 })];
  const insights = generateInsights(p);
  for (const ins of insights) {
    assert.ok(Array.isArray(ins.text));
    for (const part of ins.text) assert.ok(typeof part === "string" || typeof part.strong === "string");
  }
  assert.ok(Array.isArray(generateInsights([])[0].text));
});

test("CSV export escapes quotes, commas and spreadsheet formulas", () => {
  const csv = problemsToCsv([
    { problem_name: "two-sum", problem_title: '1. Two "Sum", again', difficulty: "easy", tags: ["array", "hash table"], time_taken: 90, attempts: 2, status: "accepted", started_at: at(2026, 11, 25), completed_at: null },
    { problem_name: "x", problem_title: "=HYPERLINK(1)", status: "failed", tags: [] },
  ], Date.parse("2026-11-25T12:00:00Z"));
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("Problem,Slug,Difficulty"));
  assert.ok(lines[1].startsWith('"1. Two ""Sum"", again",two-sum,easy,array; hash table,90,2,accepted,2026-11-25'));
  assert.ok(lines[2].startsWith("'=HYPERLINK(1),x"));
});

// ─── fetchProblems pagination (with a fake supabase client) ───────────────────
function fakeClient(rows, maxRows) {
  const calls = { count: 0 };
  class Query {
    constructor() { this.filters = []; this.from = 0; this.to = Infinity; this.wantCount = false; }
    select(_c, opts = {}) { this.wantCount = opts.count === "exact"; return this; }
    order() { return this; }
    eq(col, v) { this.filters.push((r) => r[col] === v); return this; }
    gte(col, v) { this.filters.push((r) => r[col] >= v); return this; }
    lte(col, v) { this.filters.push((r) => r[col] <= v); return this; }
    range(from, to) { this.from = from; this.to = to; return this; }
    then(resolve, reject) {
      calls.count++;
      const matching = rows.filter((r) => this.filters.every((f) => f(r)));
      const data = matching.slice(this.from, Math.min(this.to + 1, this.from + maxRows));
      return Promise.resolve({ data, error: null, count: this.wantCount ? matching.length : null }).then(resolve, reject);
    }
  }
  return { client: { from: () => new Query() }, calls };
}

const manyRows = [
  ...Array.from({ length: 2500 }, (_, i) => ({ id: i, user_id: "u1" })),
  { id: 9999, user_id: "u2" },
];

test("fetchProblems pages past the 1000-row cap", async () => {
  const { client, calls } = fakeClient(manyRows, 1000);
  const rows = await fetchProblems({ userId: "u1", client });
  assert.equal(rows.length, 2500);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2500);
  assert.equal(calls.count, 3);
});

test("fetchProblems gets everything even if the server caps lower", async () => {
  const { client } = fakeClient(manyRows, 300);
  assert.equal((await fetchProblems({ userId: "u1", client })).length, 2500);
});

test("fetchProblems with no rows makes one request", async () => {
  const { client, calls } = fakeClient([], 1000);
  assert.deepEqual(await fetchProblems({ userId: "u1", client }), []);
  assert.equal(calls.count, 1);
});
