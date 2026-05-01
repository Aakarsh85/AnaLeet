import React, { useState, useEffect, createContext, useContext } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./lib/supabase.js";
import Layout from "./components/Layout.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import ProblemsPage from "./pages/ProblemsPage.jsx";
import AnalyticsPage from "./pages/AnalyticsPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";

// ─── Auth context ─────────────────────────────────────────────────────────────
export const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#131315" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#568dff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <span className="material-symbols-outlined" style={{ color: "#002661", fontSize: 24, fontVariationSettings: "'FILL' 1" }}>code</span>
          </div>
          <p style={{ color: "#8c90a1", fontSize: 13 }}>Loading LeetFlow…</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" replace />} />
        <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/problems" element={<ProblemsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}
