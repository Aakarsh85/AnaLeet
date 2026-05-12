import React, { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { buildSessionData } from "../../lib/dataProcessor.js";
import { BentoCard, C } from "../UI.jsx";

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: "#1c1b1d",
      border: "1px solid #23232E",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
    }}>
      <p style={{ color: C.muted, fontWeight: 700, marginBottom: 6, fontSize: 11 }}>{d.date}</p>
      <p style={{ color: C.blue, marginBottom: 2 }}>
        Duration: <strong>{d.duration}m</strong>
      </p>
      <p style={{ color: "#bec6dd" }}>
        Problems: <strong>{d.problems}</strong>
      </p>
      {d.duration > 0 && d.problems > 0 && (
        <p style={{ color: C.muted, marginTop: 4, fontSize: 11 }}>
          ~{Math.round(d.duration / d.problems)}m / problem
        </p>
      )}
    </div>
  );
};

// ─── Bar colour based on duration ─────────────────────────────────────────────
function barColor(duration) {
  if (duration >= 120) return "#f43f5e";   // long session → red
  if (duration >= 60)  return "#f59e0b";   // medium       → amber
  return "#0070FF";                         // short        → blue
}

export default function SessionTimeline({ problems }) {
  const data = useMemo(() => buildSessionData(problems), [problems]);

  // Reverse so oldest → newest (left to right)
  const display = [...data].reverse();

  return (
    <BentoCard style={{ padding: 24, minHeight: 300 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="material-symbols-outlined"
            style={{ color: C.blue, fontSize: 20, fontVariationSettings: "'FILL' 1" }}
          >
            history
          </span>
          Session Timeline
        </h3>

        {/* Legend */}
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: C.blue }} />
            Duration (m)
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#bec6dd" }} />
            Problems
          </span>
          {/* Intensity key */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#0070FF" }} />
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f59e0b" }} />
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f43f5e" }} />
            <span style={{ marginLeft: 2 }}>Intensity</span>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {display.length === 0 ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: 200, color: C.muted, fontSize: 13,
        }}>
          No sessions recorded yet
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={display} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#23232E" />
              <XAxis
                dataKey="date"
                tick={{ fill: C.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                // Shorten date: "2024-05-13" → "May 13"
                tickFormatter={(v) => {
                  const d = new Date(v + "T00:00:00");
                  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                }}
              />
              {/* Left axis: duration */}
              <YAxis
                yAxisId="left"
                tick={{ fill: C.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                unit="m"
              />
              {/* Right axis: problems */}
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: C.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* Duration bars with colour-coded intensity */}
              <Bar yAxisId="left" dataKey="duration" radius={[4, 4, 0, 0]} maxBarSize={36}>
                {display.map((entry, i) => (
                  <Cell key={i} fill={barColor(entry.duration)} />
                ))}
              </Bar>

              {/* Problems solved line */}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="problems"
                stroke="#bec6dd"
                strokeWidth={2}
                dot={{ r: 3, fill: "#bec6dd", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#bec6dd" }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Summary row */}
          <div style={{
            display: "flex", gap: 24, marginTop: 16,
            paddingTop: 16, borderTop: "1px solid #23232E",
          }}>
            {[
              {
                label: "Total Sessions",
                value: display.length,
              },
              {
                label: "Avg Duration",
                value: `${Math.round(display.reduce((s, d) => s + d.duration, 0) / display.length)}m`,
              },
              {
                label: "Avg Problems",
                value: (display.reduce((s, d) => s + d.problems, 0) / display.length).toFixed(1),
              },
              {
                label: "Best Session",
                value: `${Math.max(...display.map(d => d.problems))} solved`,
              },
            ].map(({ label, value }) => (
              <div key={label}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted, marginBottom: 4 }}>
                  {label}
                </p>
                <p style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{value}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </BentoCard>
  );
}
