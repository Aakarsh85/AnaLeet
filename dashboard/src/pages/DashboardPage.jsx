import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "../App.jsx";
import { fetchProblems } from "../lib/dataProcessor.js";
import { buildDifficultyData, calcStreak, generateInsights } from "../lib/dataProcessor.js";
import ActivityHeatmap from "../components/charts/ActivityHeatmap.jsx";
import TimeTrendChart from "../components/charts/TimeTrendChart.jsx";
import { BentoCard, StatCard, InsightCard, DiffBadge, C, LoadingSpinner } from "../components/UI.jsx";

function RecentSolves({ problems }) {
  const recent = problems.slice(0, 6);
  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 20 }}>Recent Solves</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {recent.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>No solves recorded yet.</p>}
        {recent.map((p, i) => {
          const isAccepted = p.status === "accepted";
          const mins = Math.floor((p.time_taken || 0) / 60);
          const secs = ((p.time_taken || 0) % 60).toString().padStart(2, "0");
          const timeAgo = p.started_at
            ? Math.round((Date.now() - new Date(p.started_at)) / 3_600_000)
            : 0;
          return (
            <div key={i} style={{ padding: 12, background: C.container, borderRadius: 8, border: "1px solid #23232E", transition: "border-color 0.15s", cursor: "default" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(0,112,255,0.4)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#23232E"}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 6 }}>
                <DiffBadge diff={p.difficulty} />
                <span style={{ fontSize: 10, color: C.subtle }}>{timeAgo}h ago</span>
              </div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 6 }}>{p.problem_name}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: C.muted }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>timer</span>
                  {mins}m {secs}s
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: isAccepted ? "#22c55e" : "#f43f5e" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>{isAccepted ? "check_circle" : "cancel"}</span>
                  {isAccepted ? "Accepted" : "Failed"}
                </span>
                {p.attempts > 1 && <span>{p.attempts} attempts</span>}
              </div>
            </div>
          );
        })}
      </div>
      {recent.length > 0 && (
        <button style={{ width: "100%", marginTop: 16, padding: "8px", fontSize: 12, fontWeight: 700, color: C.blue, background: "transparent", border: "1px solid rgba(0,112,255,0.15)", borderRadius: 8, cursor: "pointer", transition: "background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(0,112,255,0.05)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          View All Solves →
        </button>
      )}
    </BentoCard>
  );
}

function DifficultyDistribution({ problems }) {
  const data = useMemo(() => buildDifficultyData(problems), [problems]);
  const totalSolved = data.reduce((s, d) => s + d.count, 0);
  const totals = { easy: 873, medium: 1652, hard: 836 }; // LeetCode totals (approx)

  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 24 }}>Distribution</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {data.map((d) => {
          const total = totals[d.name.toLowerCase()] || 1;
          const pct = Math.round((d.count / total) * 100);
          return (
            <div key={d.name}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted }}>{d.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{d.count} / {total}</span>
              </div>
              <div style={{ height: 6, background: C.container, borderRadius: 9999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: d.color, borderRadius: 9999, boxShadow: `0 0 8px ${d.color}60`, transition: "width 0.6s ease" }} />
              </div>
            </div>
          );
        })}
      </div>
    </BentoCard>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return;
    fetchProblems({ userId: user.id })
      .then(setProblems)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [user]);

  const stats = useMemo(() => {
    const accepted = problems.filter(p => p.status === "accepted");
    const avgTime = accepted.length
      ? Math.round(accepted.reduce((s, p) => s + (p.time_taken || 0), 0) / accepted.length / 60)
      : 0;
    const streak = calcStreak(problems);
    const insights = generateInsights(problems);
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = accepted.filter(p => p.started_at?.slice(0, 10) === today).length;
    return { total: accepted.length, avgTime, streak, insights, todayCount };
  }, [problems]);

  if (loading) return <LoadingSpinner />;

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em", color: "#fff" }}>Flow Analytics</h2>
        <p style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>Real-time performance metrics and cognitive trends.</p>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", background: "rgba(147,0,10,0.2)", border: "1px solid rgba(147,0,10,0.4)", borderRadius: 8, color: "#ffb4ab", fontSize: 13, marginBottom: 24 }}>
          Error loading data: {error}
        </div>
      )}

      {/* Bento Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>

        {/* Summary cards */}
        <div style={{ gridColumn: "span 4" }}>
          <StatCard icon="check_circle" label="Total Solved" value={stats.total} sub="Accepted solutions" accent={C.blue}>
            <div style={{ marginTop: 16, height: 4, background: C.container, borderRadius: 9999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (stats.total / 500) * 100)}%`, background: C.blue, boxShadow: `0 0 8px ${C.blue}80` }} />
            </div>
          </StatCard>
        </div>
        <div style={{ gridColumn: "span 4" }}>
          <StatCard icon="local_fire_department" label="Current Streak" value={`${stats.streak} Days`} sub={stats.streak > 7 ? "Personal best territory! 🔥" : "Keep the streak alive"} accent="#ffb599" />
        </div>
        <div style={{ gridColumn: "span 4" }}>
          <StatCard icon="avg_time" label="Avg Solve Time" value={`${stats.avgTime}m`} sub="Accepted solutions only" accent="#bec6dd" />
        </div>

        {/* Heatmap */}
        <div style={{ gridColumn: "span 8" }}>
          <ActivityHeatmap problems={problems} />
        </div>

        {/* Difficulty distribution */}
        <div style={{ gridColumn: "span 4" }}>
          <DifficultyDistribution problems={problems} />
        </div>

        {/* Time trend */}
        <div style={{ gridColumn: "span 8" }}>
          <TimeTrendChart problems={problems} />
        </div>

        {/* Recent solves */}
        <div style={{ gridColumn: "span 4" }}>
          <RecentSolves problems={problems} />
        </div>

        {/* Insights */}
        {stats.insights.length > 0 && (
          <div style={{ gridColumn: "span 12" }}>
            <BentoCard style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <span className="material-symbols-outlined" style={{ color: C.blue, fontVariationSettings: "'FILL' 1" }}>insights</span>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Smart Insights</h3>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                {stats.insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
              </div>
            </BentoCard>
          </div>
        )}
      </div>
    </div>
  );
}
