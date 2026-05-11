import React, { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import { useAuth } from "../App.jsx";
import { fetchProblems, fetchSessions, buildHourlyData, buildSessionData, buildTopicData, buildEfficiencyData, buildAttemptEfficiencyTrend, buildDifficultyProgressionData, buildSlowestProblems } from "../lib/dataProcessor.js";
import { PeakHoursChart, EfficiencyChart } from "../components/charts/PerformanceCharts.jsx";
import TopicChart from "../components/charts/TopicChart.jsx";
import { BentoCard, C, LoadingSpinner, SectionLabel } from "../components/UI.jsx";
import { subDays, format } from "date-fns";

function BurnoutMeter({ problems }) {
  // Risk = % of days with >2h solved in the last 14 days
  const recent = problems.filter(p => new Date(p.started_at) > subDays(new Date(), 14));
  const dayTimes = {};
  recent.forEach(p => {
    const d = p.started_at?.slice(0, 10);
    if (d) dayTimes[d] = (dayTimes[d] || 0) + (p.time_taken || 0);
  });
  const heavyDays = Object.values(dayTimes).filter(t => t > 7200).length;
  const risk = Math.min(100, Math.round((heavyDays / 14) * 100));
  const riskColor = risk < 30 ? C.easy : risk < 60 ? C.medium : C.hard;
  const riskLabel = risk < 30 ? "Low" : risk < 60 ? "Moderate" : "High";

  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 20 }}>Burnout Risk</h3>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        {/* Circular progress */}
        <div style={{ position: "relative", width: 120, height: 120 }}>
          <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="60" cy="60" r="50" fill="none" stroke="#23232E" strokeWidth="8" />
            <circle cx="60" cy="60" r="50" fill="none" stroke={riskColor} strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 50}`}
              strokeDashoffset={`${2 * Math.PI * 50 * (1 - risk / 100)}`}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 1s ease, stroke 0.3s" }}
            />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 24, fontWeight: 900, color: riskColor }}>{risk}%</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>{riskLabel}</span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: C.muted, textAlign: "center", lineHeight: 1.5 }}>
          {heavyDays} of 14 days had sessions over 2 hours.
          {risk >= 60 && <span style={{ color: C.hard, fontWeight: 700 }}> Consider shorter focused sessions.</span>}
          {risk < 30 && <span style={{ color: C.easy, fontWeight: 700 }}> Your pacing is excellent!</span>}
        </p>
      </div>
    </BentoCard>
  );
}

function SessionTimeline({ sessions }) {
  const data = useMemo(() => buildSessionData(sessions), [sessions]);

  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 20 }}>Session Timeline</h3>
      {data.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13 }}>No session data yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: C.container, borderRadius: 8, border: "1px solid #23232E" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(0,112,255,0.1)", border: "1px solid rgba(0,112,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.blue }}>timer</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{s.date}</p>
                <p style={{ fontSize: 11, color: C.muted }}>{s.problems} problems · {s.duration}m total</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: C.blue }}>{s.duration}m</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </BentoCard>
  );
}

function WeeklyComparison({ problems }) {
  const now = new Date();
  const thisWeek = problems.filter(p => new Date(p.started_at) > subDays(now, 7)).filter(p => p.status === "accepted");
  const lastWeek = problems.filter(p => {
    const d = new Date(p.started_at);
    return d > subDays(now, 14) && d <= subDays(now, 7) && p.status === "accepted";
  });

  const metrics = [
    { label: "Problems Solved", this: thisWeek.length, last: lastWeek.length },
    { label: "Avg Time (m)", this: thisWeek.length ? Math.round(thisWeek.reduce((s,p) => s + p.time_taken, 0) / thisWeek.length / 60) : 0,
      last: lastWeek.length ? Math.round(lastWeek.reduce((s,p) => s + p.time_taken, 0) / lastWeek.length / 60) : 0 },
  ];

  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 20 }}>This Week vs Last Week</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {metrics.map(m => {
          const diff = m.this - m.last;
          const pct = m.last > 0 ? Math.round((diff / m.last) * 100) : 0;
          return (
            <div key={m.label} style={{ padding: 16, background: C.container, borderRadius: 8, border: "1px solid #23232E" }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted, marginBottom: 12 }}>{m.label}</p>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end" }}>
                <div>
                  <span style={{ fontSize: 32, fontWeight: 900, color: "#fff" }}>{m.this}</span>
                  <span style={{ fontSize: 12, color: C.muted, marginLeft: 6 }}>this week</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: pct >= 0 ? C.easy : C.hard }}>
                    {pct >= 0 ? "+" : ""}{pct}%
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>vs {m.last} last week</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </BentoCard>
  );
}

function AttemptEfficiencyChart({ problems }) {
  const data = useMemo(() => buildAttemptEfficiencyTrend(problems), [problems]);
  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>First-Try Rate Over Time</h3>
      <p style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>% of accepted problems solved on the first attempt, by week.</p>
      {data.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13 }}>Not enough data yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data}>
            <XAxis dataKey="week" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              contentStyle={{ background: "#1c1b1d", border: "1px solid #23232E", borderRadius: 8, fontSize: 12 }}
              formatter={v => [`${v}%`, "First-try rate"]}
            />
            <Line type="monotone" dataKey="rate" stroke={C.blue} strokeWidth={2} dot={{ fill: C.blue, r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </BentoCard>
  );
}

function DifficultyProgressionChart({ problems }) {
  const data = useMemo(() => buildDifficultyProgressionData(problems), [problems]);
  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Difficulty Progression</h3>
      <p style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>Accepted solves per difficulty each week.</p>
      {data.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13 }}>Not enough data yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <XAxis dataKey="week" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip
              contentStyle={{ background: "#1c1b1d", border: "1px solid #23232E", borderRadius: 8, fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: C.muted }} />
            <Bar dataKey="easy"   name="Easy"   stackId="a" fill={C.easy}   radius={[0,0,0,0]} />
            <Bar dataKey="medium" name="Medium" stackId="a" fill={C.medium} radius={[0,0,0,0]} />
            <Bar dataKey="hard"   name="Hard"   stackId="a" fill={C.hard}   radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </BentoCard>
  );
}

function SlowestProblems({ problems }) {
  const data = useMemo(() => buildSlowestProblems(problems), [problems]);
  const diffColor = { easy: C.easy, medium: C.medium, hard: C.hard };
  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 20 }}>Slowest Accepted Solves</h3>
      {data.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13 }}>No accepted solutions yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: C.container, borderRadius: 8, border: "1px solid #23232E" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.subtle, fontFamily: "monospace", width: 18 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</p>
                <p style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{p.attempts} attempt{p.attempts > 1 ? "s" : ""}</p>
              </div>
              <span style={{
                padding: "2px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 800,
                textTransform: "uppercase", letterSpacing: "0.05em",
                color: diffColor[p.difficulty] || C.muted,
                background: `${diffColor[p.difficulty] || C.muted}18`,
                border: `1px solid ${diffColor[p.difficulty] || C.muted}30`,
              }}>
                {p.difficulty || "?"}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: C.medium, minWidth: 60, textAlign: "right" }}>
                {p.mins}m {p.secs}s
              </span>
            </div>
          ))}
        </div>
      )}
    </BentoCard>
  );
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [problems, setProblems] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetchProblems({ userId: user.id }),
      fetchSessions({ userId: user.id }),
    ]).then(([p, s]) => { setProblems(p); setSessions(s); })
      .finally(() => setLoading(false));
  }, [user]);

  if (loading) return <LoadingSpinner />;

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em", color: "#fff" }}>Deep Analytics</h2>
        <p style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>Cognitive performance patterns and advanced metrics.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>

        {/* Peak hours - wide */}
        <div style={{ gridColumn: "span 8" }}>
          <PeakHoursChart problems={problems} />
        </div>

        {/* Burnout meter */}
        <div style={{ gridColumn: "span 4" }}>
          <BurnoutMeter problems={problems} />
        </div>

        {/* Topic chart */}
        <div style={{ gridColumn: "span 7" }}>
          <TopicChart problems={problems} />
        </div>

        {/* Efficiency */}
        <div style={{ gridColumn: "span 5" }}>
          <EfficiencyChart problems={problems} />
        </div>

        {/* Session timeline */}
        <div style={{ gridColumn: "span 6" }}>
          <SessionTimeline sessions={sessions} />
        </div>

        {/* Weekly comparison */}
        <div style={{ gridColumn: "span 6" }}>
          <WeeklyComparison problems={problems} />
        </div>

        {/* Attempt efficiency over time */}
        <div style={{ gridColumn: "span 6" }}>
          <AttemptEfficiencyChart problems={problems} />
        </div>

        {/* Difficulty progression */}
        <div style={{ gridColumn: "span 6" }}>
          <DifficultyProgressionChart problems={problems} />
        </div>

        {/* Slowest problems */}
        <div style={{ gridColumn: "span 12" }}>
          <SlowestProblems problems={problems} />
        </div>
      </div>
    </div>
  );
}
