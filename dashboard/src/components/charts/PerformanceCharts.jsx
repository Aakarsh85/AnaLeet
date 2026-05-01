import React, { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { buildHourlyData, buildEfficiencyData } from "../../lib/dataProcessor.js";
import { BentoCard, C } from "../UI.jsx";

// ─── Peak Hours ──────────────────────────────────────────────────────────────
export function PeakHoursChart({ problems }) {
  const data = useMemo(() => buildHourlyData(problems), [problems]);

  const maxCount = Math.max(...data.map(d => d.count), 1);
  const peakHour = data.reduce((best, h) => (h.accepted > best.accepted ? h : best), data[0]);

  return (
    <BentoCard style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Peak Performance Hours</h3>
        {peakHour.accepted > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: C.blue, background: "rgba(0,112,255,0.1)", padding: "4px 10px", borderRadius: 9999, border: "1px solid rgba(0,112,255,0.2)" }}>
            Peak: {peakHour.hour}:00
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
          <XAxis dataKey="hour" tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false}
            tickFormatter={h => h % 6 === 0 ? `${h}:00` : ""} />
          <YAxis tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v, name) => [v, name === "count" ? "Problems" : "Accepted"]}
            contentStyle={{ background: "#1c1b1d", border: "1px solid #23232E", borderRadius: 8, fontSize: 12 }}
            labelFormatter={h => `${h}:00 – ${h+1}:00`}
          />
          <Bar dataKey="count" radius={[3,3,0,0]} maxBarSize={18}>
            {data.map((h, i) => (
              <Cell key={i} fill={h.hour === peakHour.hour ? C.blue : "rgba(0,112,255,0.25)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </BentoCard>
  );
}

// ─── Efficiency / Attempts Pie ────────────────────────────────────────────────
const PIE_COLORS = [C.easy, C.blue, C.medium, C.hard];

export function EfficiencyChart({ problems }) {
  const data = useMemo(() => buildEfficiencyData(problems), [problems]);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 20 }}>Attempts to Success</h3>
      {total === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 180, color: C.muted, fontSize: 13 }}>
          No accepted solutions yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 11, color: C.muted }}>{v}</span>} />
            <Tooltip contentStyle={{ background: "#1c1b1d", border: "1px solid #23232E", borderRadius: 8, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </BentoCard>
  );
}
