import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { buildTopicData } from "../../lib/dataProcessor.js";
import { BentoCard, C } from "../UI.jsx";

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "#1c1b1d", border: "1px solid #23232E", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#fff", fontWeight: 700, marginBottom: 6 }}>{d.tag}</p>
      <p style={{ color: C.blue }}>Problems: {d.total}</p>
      <p style={{ color: "#22c55e" }}>Success rate: {d.successRate}%</p>
      <p style={{ color: "#bec6dd" }}>Avg time: {d.avgTime}m</p>
    </div>
  );
};

export default function TopicChart({ problems }) {
  const data = useMemo(() => buildTopicData(problems), [problems]);

  return (
    <BentoCard style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 20 }}>Topic-wise Analysis</h3>

      {data.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: C.muted, fontSize: 13 }}>
          Solve tagged problems to unlock topic analysis
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 60, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#23232E" horizontal={false} />
            <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis dataKey="tag" type="category" tick={{ fill: "#e5e1e4", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={16}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.successRate > 70 ? C.blue : entry.successRate > 40 ? "#b0c6ff" : "#424655"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Success rate legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 12, borderTop: "1px solid #23232E" }}>
        {[{ color: C.blue, label: ">70% success" }, { color: "#b0c6ff", label: "40–70%" }, { color: "#424655", label: "<40%" }].map(({ color, label }) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} /> {label}
          </span>
        ))}
      </div>
    </BentoCard>
  );
}
