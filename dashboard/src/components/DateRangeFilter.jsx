import React from "react";
import { C } from "./UI.jsx";

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: 0 },
];

export default function DateRangeFilter({ active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {PRESETS.map(({ label, days }) => (
        <button
          key={label}
          onClick={() => onChange(days)}
          style={{
            padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: "pointer", border: "1px solid", transition: "all 0.15s",
            background: active === days ? "rgba(0,112,255,0.15)" : "transparent",
            color: active === days ? C.blue : C.muted,
            borderColor: active === days ? "rgba(0,112,255,0.3)" : "#23232E",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
