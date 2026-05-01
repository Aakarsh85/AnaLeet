import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { buildTimeTrendData } from "../../lib/dataProcessor.js";
import { BentoCard, C } from "../UI.jsx";

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "#1c1b1d", border: "1px solid #23232E", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#fff", fontWeight: 700, marginBottom: 4 }}>{d.name}</p>
      <p style={{ color: C.blue }}>Time: {d.time}m</p>
      <p style={{ color: "#bec6dd" }}>Rolling avg: {d.avg}m</p>
    </div>
  );
};

export default function TimeTrendChart({ problems }) {
  const data = useMemo(() => buildTimeTrendData(problems), [problems]);

  // Downsample to last 50 for readability
  const display = data.slice(-50);

  return (
    <BentoCard style={{ padding: 24, minHeight: 320 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Time vs Complexity Trend</h3>
        <div style={{ display: "flex", gap: 16 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.blue }} /> Solve Time (m)
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#bec6dd" }} /> Rolling Avg
          </span>
        </div>
      </div>
      {display.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: C.muted, fontSize: 13 }}>
          No accepted solutions yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={display} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#23232E" />
            <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(display.length / 8)} />
            <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} unit="m" />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="time" stroke={C.blue} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: C.blue }} />
            <Line type="monotone" dataKey="avg" stroke="#bec6dd" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </BentoCard>
  );
}
