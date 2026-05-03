import React, { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../App.jsx";

const css = {
  sidebar: {
    position: "fixed", left: 0, top: 0, height: "100%",
    display: "flex", flexDirection: "column", padding: "16px",
    background: "rgba(18,18,23,0.8)", backdropFilter: "blur(20px)",
    width: 256, borderRight: "1px solid #23232E",
    boxShadow: "inset 1px 0 0 0 rgba(255,255,255,0.05)", zIndex: 50,
  },
  logo: {
    marginBottom: 32, padding: "0 16px",
    display: "flex", alignItems: "center", gap: 12,
  },
  logoIcon: {
    width: 32, height: 32, borderRadius: 8, background: "#568dff",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  header: {
    position: "fixed", top: 0, right: 0,
    width: "calc(100% - 256px)", zIndex: 40,
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "0 32px",
    background: "rgba(18,18,23,0.8)", backdropFilter: "blur(12px)",
    height: 64, borderBottom: "1px solid #23232E",
    fontSize: 14, fontWeight: 500,
  },
  main: {
    marginLeft: 256, paddingTop: 88, padding: "88px 32px 48px",
    minHeight: "100vh",
  },
};

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/problems", label: "Problems", icon: "list_alt" },
  { to: "/analytics", label: "Analytics", icon: "leaderboard" },
];

function NavItem({ to, label, icon }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      style={({ isActive }) => ({
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", borderRadius: 8,
        textDecoration: "none", fontSize: 14, fontWeight: 500,
        transition: "all 0.15s",
        ...(isActive
          ? {
              background: "rgba(0,112,255,0.1)",
              color: "#0070FF",
              borderRight: "2px solid #0070FF",
              boxShadow: "0 0 15px rgba(0,112,255,0.3)",
            }
          : { color: "#6b7280" }),
      })}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{icon}</span>
      {label}
    </NavLink>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <>
      {/* Sidebar */}
      <aside style={css.sidebar}>
        <div style={css.logo}>
          <div style={css.logoIcon}>
            <span className="material-symbols-outlined" style={{ color: "#002661", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>code</span>
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.03em", color: "#fff" }}>LeetFlow</h1>
            <p style={{ fontSize: 10, color: "#b0c6ff", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Analytics</p>
          </div>
        </div>

        <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {NAV_ITEMS.map((item) => <NavItem key={item.to} {...item} />)}
        </nav>

        <div style={{ borderTop: "1px solid #23232E", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#23232E", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#8c90a1" }}>person</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "#e5e1e4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user?.email || "User"}
              </p>
              <p style={{ fontSize: 10, color: "#6b7280" }}>Pro</p>
            </div>
          </div>
          <a
            href="/leetflow-extension.zip"
            download="leetflow-extension.zip"
            style={{ width: "100%", padding: "8px 16px", background: "rgba(0,112,255,0.08)", border: "1px solid rgba(0,112,255,0.2)", color: "#568dff", fontSize: 12, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 8, transition: "all 0.15s", marginBottom: 4, textDecoration: "none" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,112,255,0.15)"; e.currentTarget.style.borderColor = "rgba(0,112,255,0.4)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,112,255,0.08)"; e.currentTarget.style.borderColor = "rgba(0,112,255,0.2)"; }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>extension</span>
            Download Extension
          </a>
          <button onClick={handleSignOut} style={{ width: "100%", padding: "8px 16px", background: "transparent", border: "none", color: "#6b7280", fontSize: 12, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 8, transition: "color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.color = "#e5e1e4"}
            onMouseLeave={e => e.currentTarget.style.color = "#6b7280"}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>logout</span>
            Sign out
          </button>
        </div>
      </aside>

      {/* Top header */}
      <header style={css.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <div style={{ position: "relative" }}>
            <span className="material-symbols-outlined" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280", fontSize: 18 }}>search</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search problems…"
              style={{
                background: "#0e0e10", border: "1px solid #23232E", borderRadius: 9999,
                paddingLeft: 40, paddingRight: 16, paddingTop: 6, paddingBottom: 6,
                width: 256, fontSize: 12, color: "#e5e1e4", outline: "none",
              }}
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
          </span>
        </div>
      </header>

      {/* Page content */}
      <main style={css.main}>
        <Outlet />
      </main>
    </>
  );
}