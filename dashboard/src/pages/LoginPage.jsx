import React, { useState } from "react";
import { supabase } from "../lib/supabase.js";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function handleEmailAuth(e) {
    e.preventDefault();
    setLoading(true); setError(null); setMessage(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Check your email for a confirmation link.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#131315", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      {/* Background glow */}
      <div style={{ position: "fixed", top: "20%", left: "50%", transform: "translateX(-50%)", width: 600, height: 300, background: "rgba(0,112,255,0.06)", borderRadius: "50%", filter: "blur(80px)", pointerEvents: "none" }} />

      <div style={{ width: "100%", maxWidth: 400, background: "rgba(18,18,23,0.9)", border: "1px solid #23232E", borderRadius: 16, padding: 40, backdropFilter: "blur(20px)", boxShadow: "inset 1px 1px 0 0 rgba(255,255,255,0.05)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#568dff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <span className="material-symbols-outlined" style={{ color: "#002661", fontSize: 28, fontVariationSettings: "'FILL' 1" }}>code</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.03em", color: "#fff" }}>LeetFlow</h1>
          <p style={{ fontSize: 13, color: "#8c90a1", marginTop: 4 }}>Performance analytics for serious coders</p>
        </div>

        {/* Google OAuth */}
        <button onClick={handleGoogle} disabled={loading}
          style={{ width: "100%", padding: "11px 16px", background: "#1c1b1d", border: "1px solid #23232E", borderRadius: 8, color: "#e5e1e4", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 24, transition: "background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "#2a2a2c"}
          onMouseLeave={e => e.currentTarget.style.background = "#1c1b1d"}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1, height: 1, background: "#23232E" }} />
          <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>or email</span>
          <div style={{ flex: 1, height: 1, background: "#23232E" }} />
        </div>

        <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address"
            style={{ padding: "10px 14px", background: "#0e0e10", border: "1px solid #23232E", borderRadius: 8, color: "#e5e1e4", fontSize: 14, outline: "none" }}
            onFocus={e => e.target.style.borderColor = "#0070FF"}
            onBlur={e => e.target.style.borderColor = "#23232E"} />
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Password"
            style={{ padding: "10px 14px", background: "#0e0e10", border: "1px solid #23232E", borderRadius: 8, color: "#e5e1e4", fontSize: 14, outline: "none" }}
            onFocus={e => e.target.style.borderColor = "#0070FF"}
            onBlur={e => e.target.style.borderColor = "#23232E"} />

          {error && <p style={{ color: "#ffb4ab", fontSize: 12, padding: "8px 12px", background: "rgba(147,0,10,0.15)", borderRadius: 6, border: "1px solid rgba(147,0,10,0.3)" }}>{error}</p>}
          {message && <p style={{ color: "#b0c6ff", fontSize: 12, padding: "8px 12px", background: "rgba(0,45,111,0.2)", borderRadius: 6, border: "1px solid rgba(0,45,111,0.3)" }}>{message}</p>}

          <button type="submit" disabled={loading}
            style={{ padding: "11px", background: "#0070FF", border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 4, boxShadow: "0 0 20px rgba(0,112,255,0.3)", transition: "opacity 0.15s", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Loading…" : mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "#6b7280" }}>
          {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
          <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            style={{ background: "none", border: "none", color: "#b0c6ff", cursor: "pointer", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}>
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
