import { supabase } from "./supabase.js";
import {
  subDays, addDays, format, parseISO, isWithinInterval, startOfDay, endOfDay,
  startOfWeek, differenceInCalendarDays,
} from "date-fns";

// ─── Fetch raw problems from Supabase ─────────────────────────────────────────
// PostgREST caps the rows returned per request (1000 by default on Supabase),
// so fetch page by page until every matching row has been read.
const FETCH_PAGE_SIZE = 1000;

export async function fetchProblems({ userId, from, to } = {}) {
  const pageQuery = (offset, withCount) => {
    let query = supabase
      .from("problems")
      .select("*", withCount ? { count: "exact" } : {})
      .order("started_at", { ascending: false })
      .order("id", { ascending: true }) // stable order across pages
      .range(offset, offset + FETCH_PAGE_SIZE - 1);

    if (userId) query = query.eq("user_id", userId);
    if (from) query = query.gte("started_at", from);
    if (to) query = query.lte("started_at", to);
    return query;
  };

  const rows = [];
  let total = Infinity;
  while (rows.length < total) {
    const isFirstPage = rows.length === 0;
    const { data, error, count } = await pageQuery(rows.length, isFirstPage);
    if (error) throw error;
    if (isFirstPage && typeof count === "number") total = count;
    if (!data?.length) break;
    rows.push(...data);
  }
  return rows;
}

export async function fetchSessions({ userId } = {}) {
  let query = supabase
    .from("sessions")
    .select("*")
    .order("start_time", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// ─── Dates and status ─────────────────────────────────────────────────────────

/**
 * Calendar date (YYYY-MM-DD) of a timestamp in the viewer's local time zone.
 * Timestamps are stored in UTC, so slicing the ISO string would put late-night
 * or early-morning solves on the wrong day.
 */
export function localDateKey(value) {
  if (!value) return null;
  const date = typeof value === "string" ? parseISO(value) : value;
  return Number.isNaN(date.getTime()) ? null : format(date, "yyyy-MM-dd");
}

// An in_progress row that hasn't been updated for this long was left without
// a final update (tab closed before it could report, or a record from an
// extension version that never recorded failures). While a problem is open the
// extension updates its row every few minutes.
const STALE_IN_PROGRESS_MS = 60 * 60_000;

/** "accepted", "failed", or "in_progress" (still being worked on). */
export function effectiveStatus(problem, now = Date.now()) {
  if (problem.status === "accepted" || problem.status === "failed") return problem.status;
  const lastUpdate = Date.parse(problem.updated_at || problem.started_at || "");
  if (Number.isNaN(lastUpdate) || now - lastUpdate > STALE_IN_PROGRESS_MS) return "failed";
  return "in_progress";
}

// ─── Data processing helpers (all client-side) ────────────────────────────────

/** Accepted problems per local date (YYYY-MM-DD) */
export function groupByDate(problems) {
  return problems.reduce((acc, p) => {
    const date = localDateKey(p.started_at) ?? "unknown";
    acc[date] = (acc[date] || 0) + (p.status === "accepted" ? 1 : 0);
    return acc;
  }, {});
}

/**
 * Heatmap days covering the last year, starting on a Sunday so that each run
 * of 7 days is one Sunday–Saturday column.
 */
export function buildHeatmapData(problems, today = new Date()) {
  const byDate = groupByDate(problems);
  const start = startOfWeek(subDays(today, 364)); // weeks start on Sunday
  const days = [];
  const span = differenceInCalendarDays(today, start);
  for (let i = 0; i <= span; i++) {
    const key = format(addDays(start, i), "yyyy-MM-dd");
    days.push({ date: key, count: byDate[key] ?? 0 });
  }
  return days;
}

/** Difficulty distribution */
export function buildDifficultyData(problems) {
  const counts = { easy: 0, medium: 0, hard: 0 };
  const times = { easy: 0, medium: 0, hard: 0 };
  for (const p of problems) {
    if (p.status !== "accepted") continue;
    const d = (p.difficulty || "").toLowerCase();
    if (d in counts) {
      counts[d]++;
      times[d] += p.time_taken ?? 0;
    }
  }
  return [
    { name: "Easy", count: counts.easy, totalTime: times.easy, color: "#22c55e" },
    { name: "Medium", count: counts.medium, totalTime: times.medium, color: "#f59e0b" },
    { name: "Hard", count: counts.hard, totalTime: times.hard, color: "#f43f5e" },
  ];
}

/** Time trend — weekly average solve time */
export function buildTimeTrendData(problems, windowSize = 7) {
  const accepted = problems
    .filter((p) => p.status === "accepted" && p.time_taken > 0)
    .sort((a, b) => new Date(a.started_at) - new Date(b.started_at));

  const points = accepted.map((p, i) => {
    const slice = accepted.slice(Math.max(0, i - windowSize + 1), i + 1);
    const avg = slice.reduce((s, x) => s + x.time_taken, 0) / slice.length;
    return {
      label: `#${i + 1}`,
      time: Math.round(p.time_taken / 60),
      avg: Math.round(avg / 60),
      name: p.problem_name,
      difficulty: p.difficulty,
    };
  });
  return points;
}

/** Topic-wise analysis */
export function buildTopicData(problems) {
  const topicMap = {};
  for (const p of problems) {
    const tags = Array.isArray(p.tags) ? p.tags : [];
    for (const tag of tags) {
      if (!topicMap[tag]) topicMap[tag] = { tag, total: 0, accepted: 0, totalTime: 0 };
      topicMap[tag].total++;
      if (p.status === "accepted") topicMap[tag].accepted++;
      topicMap[tag].totalTime += p.time_taken ?? 0;
    }
  }
  return Object.values(topicMap)
    .filter((t) => t.total >= 1)
    .map((t) => ({
      ...t,
      successRate: t.total > 0 ? Math.round((t.accepted / t.total) * 100) : 0,
      avgTime: t.accepted > 0 ? Math.round(t.totalTime / t.accepted / 60) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
}

/** Attempts efficiency */
export function buildEfficiencyData(problems) {
  const buckets = { "1 try": 0, "2 tries": 0, "3-5 tries": 0, "6+": 0 };
  for (const p of problems.filter((p) => p.status === "accepted")) {
    const a = p.attempts || 1;
    if (a === 1) buckets["1 try"]++;
    else if (a === 2) buckets["2 tries"]++;
    else if (a <= 5) buckets["3-5 tries"]++;
    else buckets["6+"]++;
  }
  return Object.entries(buckets).map(([name, value]) => ({ name, value }));
}

/**
 * Session timeline data — groups problems by local calendar date.
 * Each unique date = one "session" entry, so this works regardless
 * of whether session_id is populated on problem rows.
 */
export function buildSessionData(problems) {
  const dateMap = {};

  for (const p of problems) {
    const date = localDateKey(p.started_at);
    if (!date) continue;
    if (!dateMap[date]) dateMap[date] = { date, totalTime: 0, count: 0 };
    dateMap[date].totalTime += p.time_taken ?? 0;
    dateMap[date].count++;
  }

  return Object.values(dateMap)
    .sort((a, b) => (a.date < b.date ? 1 : -1))   // newest first
    .slice(0, 10)
    .map(({ date, totalTime, count }) => ({
      date,
      duration: Math.round(totalTime / 60),
      problems: count,
    }));
}

/** Peak performance hours */
export function buildHourlyData(problems) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, accepted: 0 }));
  for (const p of problems) {
    if (!p.started_at) continue;
    const h = new Date(p.started_at).getHours();
    hours[h].count++;
    if (p.status === "accepted") hours[h].accepted++;
  }
  return hours;
}

// ─── Smart insights engine ────────────────────────────────────────────────────
export function generateInsights(problems) {
  const insights = [];
  if (!problems.length) return [{ type: "info", text: "Solve your first problem to unlock insights!" }];

  const topicData = buildTopicData(problems);

  // Slowest topic
  const slowest = [...topicData].sort((a, b) => b.avgTime - a.avgTime)[0];
  if (slowest && slowest.avgTime > 0) {
    insights.push({
      type: "warning",
      title: "Optimization Alert",
      label: `Topic: ${slowest.tag}`,
      text: `You average <strong>${slowest.avgTime}m</strong> on ${slowest.tag} problems — try timed drills to speed up.`,
    });
  }

  // Fatigue (after 1hr)
  const longSessions = problems.filter((p) => (p.time_taken ?? 0) > 3600);
  if (longSessions.length > 2) {
    const accepted = longSessions.filter((p) => p.status === "accepted").length;
    const rate = Math.round((accepted / longSessions.length) * 100);
    insights.push({
      type: "alert",
      title: "Fatigue Detection",
      label: "Pattern",
      text: `After 60 min your success rate is <strong>${rate}%</strong> — take short breaks to maintain accuracy.`,
    });
  }

  // Best time of day
  const hourly = buildHourlyData(problems);
  const peakHour = hourly.reduce((best, h) => (h.accepted > best.accepted ? h : best), hourly[0]);
  if (peakHour.accepted > 0) {
    insights.push({
      type: "success",
      title: "Peak Performance",
      label: "Time of Day",
      text: `You solve problems best around <strong>${peakHour.hour}:00–${peakHour.hour + 1}:00</strong>. Schedule hard problems then.`,
    });
  }

  // Improvement vs last week
  const now = new Date();
  const thisWeek = problems.filter((p) =>
    isWithinInterval(parseISO(p.started_at || new Date().toISOString()), {
      start: startOfDay(subDays(now, 7)),
      end: endOfDay(now),
    })
  );
  const lastWeek = problems.filter((p) =>
    isWithinInterval(parseISO(p.started_at || new Date().toISOString()), {
      start: startOfDay(subDays(now, 14)),
      end: endOfDay(subDays(now, 7)),
    })
  );
  if (thisWeek.length > 0 && lastWeek.length > 0) {
    const diff = thisWeek.length - lastWeek.length;
    const pct = Math.round((diff / lastWeek.length) * 100);
    insights.push({
      type: pct >= 0 ? "success" : "info",
      title: "Weekly Comparison",
      label: "Progress",
      text: `This week: <strong>${thisWeek.length}</strong> problems vs last week: <strong>${lastWeek.length}</strong> (${pct > 0 ? "+" : ""}${pct}%).`,
    });
  }

  return insights.slice(0, 3);
}

// ─── Streak calculation ───────────────────────────────────────────────────────
/**
 * Number of consecutive local days, counting back from today, with at least
 * one accepted solve. A streak that ended yesterday still counts, since today
 * isn't over yet. Any missed day ends the streak.
 */
export function calcStreak(problems, today = new Date()) {
  const solvedDays = new Set(
    problems
      .filter((p) => p.status === "accepted")
      .map((p) => localDateKey(p.started_at))
      .filter(Boolean)
  );

  let cursor = today;
  if (!solvedDays.has(format(cursor, "yyyy-MM-dd"))) cursor = subDays(cursor, 1);

  let streak = 0;
  while (solvedDays.has(format(cursor, "yyyy-MM-dd"))) {
    streak++;
    cursor = subDays(cursor, 1);
  }
  return streak;
}

// ─── Weekly grouping helpers (internal) ───────────────────────────────────────
// Monday of the timestamp's (local) week as a sortable YYYY-MM-DD key
function weekStartKey(timestamp) {
  return format(startOfWeek(parseISO(timestamp), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

// The most recent `limit` weeks that have data, ordered oldest → newest
function recentWeeks(weekMap, limit = 8) {
  return Object.keys(weekMap)
    .sort()
    .slice(-limit)
    .map((key) => ({ week: format(parseISO(key), "MMM d"), ...weekMap[key] }));
}

/** Weekly first-try rate over time */
export function buildAttemptEfficiencyTrend(problems) {
  const weekMap = {};
  for (const p of problems.filter(p => p.status === "accepted" && p.started_at)) {
    const key = weekStartKey(p.started_at);
    if (!weekMap[key]) weekMap[key] = { total: 0, firstTry: 0 };
    weekMap[key].total++;
    if ((p.attempts || 1) === 1) weekMap[key].firstTry++;
  }
  return recentWeeks(weekMap).map((w) => ({ ...w, rate: Math.round((w.firstTry / w.total) * 100) }));
}

/** Weekly difficulty breakdown */
export function buildDifficultyProgressionData(problems) {
  const weekMap = {};
  for (const p of problems.filter(p => p.status === "accepted" && p.started_at)) {
    const key = weekStartKey(p.started_at);
    if (!weekMap[key]) weekMap[key] = { easy: 0, medium: 0, hard: 0 };
    const d = (p.difficulty || "").toLowerCase();
    if (d in weekMap[key]) weekMap[key][d]++;
  }
  return recentWeeks(weekMap);
}

/** Top N slowest accepted problems */
export function buildSlowestProblems(problems, limit = 8) {
  return problems
    .filter(p => p.status === "accepted" && (p.time_taken || 0) > 0)
    .sort((a, b) => b.time_taken - a.time_taken)
    .slice(0, limit)
    .map(p => ({
      name:       p.problem_name,
      difficulty: p.difficulty,
      mins:       Math.floor(p.time_taken / 60),
      secs:       (p.time_taken % 60).toString().padStart(2, "0"),
      attempts:   p.attempts || 1,
    }));
}
