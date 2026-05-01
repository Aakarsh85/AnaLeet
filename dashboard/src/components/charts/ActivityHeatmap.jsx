import React, { useMemo } from "react";
import { buildHeatmapData } from "../../lib/dataProcessor.js";
import { BentoCard, C } from "../UI.jsx";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["S","M","T","W","T","F","S"];

function cellColor(count) {
  if (count === 0) return "#201f21";
  if (count === 1) return "rgba(0,112,255,0.2)";
  if (count === 2) return "rgba(0,112,255,0.4)";
  if (count === 3) return "rgba(0,112,255,0.65)";
  return "#0070FF";
}

export default function ActivityHeatmap({ problems }) {
  const days = useMemo(() => buildHeatmapData(problems), [problems]);

  // Build columns of 7 days each (weeks)
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // Month labels (approximate)
  const monthLabels = useMemo(() => {
    const labels = [];
    let lastMonth = -1;
    weeks.forEach((week, wi) => {
      const m = new Date(week[0].date).getMonth();
      if (m !== lastMonth) { labels.push({ wi, label: MONTHS[m] }); lastMonth = m; }
    });
    return labels;
  }, [weeks]);

  const total = days.reduce((s, d) => s + d.count, 0);

  return (
    <BentoCard style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" style={{ color: C.blue, fontSize: 20 }}>calendar_today</span>
          Activity Heatmap
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.muted }}>
          <span>{total} problems in the last year</span>
          <span>Less</span>
          {[0,1,2,3,4].map(i => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: cellColor(i) }} />
          ))}
          <span>More</span>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 700 }}>
          {/* Month labels */}
          <div style={{ display: "flex", marginLeft: 24, marginBottom: 4 }}>
            {weeks.map((_, wi) => {
              const found = monthLabels.find(m => m.wi === wi);
              return (
                <div key={wi} style={{ width: 13, flexShrink: 0, fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>
                  {found ? found.label : ""}
                </div>
              );
            })}
          </div>

          {/* Grid */}
          <div style={{ display: "flex", gap: 2 }}>
            {/* Day labels */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: 4 }}>
              {DAYS.map((d, i) => (
                <div key={i} style={{ width: 11, height: 11, fontSize: 8, color: C.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>{i % 2 === 1 ? d : ""}</div>
              ))}
            </div>

            {/* Weeks */}
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {week.map((day, di) => (
                  <div
                    key={di}
                    title={`${day.date}: ${day.count} problem${day.count !== 1 ? "s" : ""}`}
                    style={{ width: 11, height: 11, borderRadius: 2, background: cellColor(day.count), cursor: "default", transition: "opacity 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </BentoCard>
  );
}
