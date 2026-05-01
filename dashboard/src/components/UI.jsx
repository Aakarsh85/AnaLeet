import React from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────
export const C = {
  surface: "#131315",
  card: "#121217",
  cardBorder: "#23232E",
  containerHigh: "#2a2a2c",
  container: "#201f21",
  blue: "#0070FF",
  blueDim: "#b0c6ff",
  text: "#e5e1e4",
  muted: "#8c90a1",
  subtle: "#6b7280",
  easy: "#22c55e",
  medium: "#f59e0b",
  hard: "#f43f5e",
  orange: "#f36420",
};

export function BentoCard({ children, style, className }) {
  return (
    <div style={{
      background: "rgba(18,18,23,0.8)",
      backdropFilter: "blur(20px)",
      border: `1px solid ${C.cardBorder}`,
      borderRadius: 12,
      boxShadow: "inset 1px 1px 0 0 rgba(255,255,255,0.05)",
      ...style,
    }}>
      {children}
    </div>
  );
}

export function SectionLabel({ children }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted }}>
      {children}
    </p>
  );
}

export function DiffBadge({ diff }) {
  const d = (diff || "").toLowerCase();
  const map = {
    easy: { bg: "rgba(34,197,94,0.1)", color: C.easy, border: "rgba(34,197,94,0.2)" },
    medium: { bg: "rgba(245,158,11,0.1)", color: C.medium, border: "rgba(245,158,11,0.2)" },
    hard: { bg: "rgba(244,63,94,0.1)", color: C.hard, border: "rgba(244,63,94,0.2)" },
  };
  const s = map[d] || { bg: "rgba(139,144,161,0.1)", color: C.muted, border: "rgba(139,144,161,0.2)" };
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 800,
      textTransform: "uppercase", letterSpacing: "0.05em",
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {diff || "?"}
    </span>
  );
}

export function StatusBadge({ status }) {
  const isAccepted = status === "accepted";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: isAccepted ? "#22c55e" : "#f43f5e" }}>
      <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>
        {isAccepted ? "check_circle" : "cancel"}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700 }}>{isAccepted ? "Accepted" : "Not Accepted"}</span>
    </div>
  );
}

export function InsightCard({ insight }) {
  const typeStyle = {
    warning: { border: "rgba(244,63,94,0.5)", title: C.hard },
    alert: { border: "rgba(243,100,32,0.5)", title: C.orange },
    success: { border: "rgba(34,197,94,0.5)", title: C.easy },
    info: { border: "rgba(176,198,255,0.3)", title: C.blueDim },
  };
  const s = typeStyle[insight.type] || typeStyle.info;
  return (
    <div style={{ padding: 16, borderRadius: 8, background: C.container, borderLeft: `4px solid ${s.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: s.title }}>{insight.title}</span>
        {insight.label && <span style={{ fontSize: 10, color: C.subtle }}>{insight.label}</span>}
      </div>
      <p style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: insight.text }} />
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 64 }}>
      <div style={{ width: 32, height: 32, border: `3px solid ${C.cardBorder}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function StatCard({ icon, label, value, sub, accent = C.blueDim, children }) {
  return (
    <BentoCard style={{ padding: 24, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, right: 0, width: 128, height: 128, background: `${accent}08`, borderRadius: "50%", transform: "translate(40%, -40%)", filter: "blur(40px)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 16 }}>
        <span className="material-symbols-outlined" style={{ color: accent, fontSize: 22 }}>{icon}</span>
      </div>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted, marginBottom: 4 }}>{label}</p>
      <div style={{ fontSize: 36, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em" }}>{value}</div>
      {sub && <p style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>{sub}</p>}
      {children}
    </BentoCard>
  );
}
