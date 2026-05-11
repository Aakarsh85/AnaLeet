import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "../App.jsx";
import { supabase } from "../lib/supabase.js";
import { fetchProblems, calcStreak } from "../lib/dataProcessor.js";
import { BentoCard, C, LoadingSpinner } from "../components/UI.jsx";

// ─── Constants ────────────────────────────────────────────────────────────────
const TIME_FILTERS = [
  { label: "This Week",  days: 7    },
  { label: "This Month", days: 30   },
  { label: "All Time",   days: null },
];

const RANK_ACCENT = { 1: "#f59e0b", 2: C.muted, 3: C.orange };

// ─── Data fetching ────────────────────────────────────────────────────────────
async function fetchLeaderboard({ days }) {
  const dateFrom = days
    ? new Date(Date.now() - days * 86_400_000).toISOString()
    : null;
  const { data, error } = await supabase.rpc("get_leaderboard", {
    date_from: dateFrom,
    date_to: null,
  });
  if (error) throw error;
  return data || [];
}

// ─── Podium ───────────────────────────────────────────────────────────────────
function Podium({ entries, currentUserId }) {
  // Visual order: 2nd · 1st · 3rd
  const slots = [
    { entry: entries[1], rank: 2 },
    { entry: entries[0], rank: 1 },
    { entry: entries[2], rank: 3 },
  ].filter((s) => s.entry);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
      {slots.map(({ entry, rank }) => {
        const accent        = RANK_ACCENT[rank];
        const isFirst       = rank === 1;
        const isCurrentUser = entry.user_id === currentUserId;

        return (
          <BentoCard
            key={entry.user_id}
            style={{
              padding: isFirst ? "28px 24px" : "20px 24px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
              position: "relative",
              ...(isFirst       && { border: `1px solid rgba(245,158,11,0.35)`, boxShadow: "0 0 30px rgba(245,158,11,0.08)" }),
              ...(isCurrentUser && !isFirst && { border: `1px solid rgba(0,112,255,0.3)` }),
            }}
          >
            <span style={{ position: "absolute", top: 12, left: 16, fontSize: 12, fontWeight: 900, color: accent, fontFamily: "monospace" }}>
              #{rank}
            </span>

            {/* Avatar initial */}
            <div style={{
              width: isFirst ? 72 : 56, height: isFirst ? 72 : 56,
              borderRadius: "50%", flexShrink: 0,
              background: `${accent}18`, border: `2px solid ${accent}40`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: isFirst ? 26 : 20, fontWeight: 900, color: accent,
            }}>
              {(entry.display_name || "?")[0].toUpperCase()}
            </div>

            {/* Name + solved */}
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: isFirst ? 16 : 14, fontWeight: 700, color: isCurrentUser ? C.blue : "#fff", marginBottom: 2 }}>
                {entry.display_name}
                {isCurrentUser && <span style={{ fontSize: 10, color: C.blue, marginLeft: 6 }}>YOU</span>}
              </p>
              <p style={{ fontSize: 12, color: C.muted }}>{entry.total_solved} solved</p>
            </div>

            {/* Accuracy + points chips */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{
                padding: "3px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 700,
                background: `${accent}18`, color: accent, border: `1px solid ${accent}30`,
              }}>
                {entry.accuracy}% ACC
              </span>
              <span style={{
                padding: "3px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 700,
                background: "rgba(0,112,255,0.1)", color: C.blue, border: "1px solid rgba(0,112,255,0.2)",
              }}>
                {Number(entry.points).toLocaleString()} PTS
              </span>
            </div>
          </BentoCard>
        );
      })}
    </div>
  );
}

// ─── Rankings table ───────────────────────────────────────────────────────────
function RankingsTable({ entries, currentUserId }) {
  const tableEntries    = entries.slice(3);
  const currentUserRank = entries.findIndex((e) => e.user_id === currentUserId) + 1;
  const currentEntry    = entries.find((e) => e.user_id === currentUserId);
  // Show sticky current-user row only if they're in top 3 (not visible in table)
  const showStickyRow   = currentUserRank > 0 && currentUserRank <= 3 && currentEntry;

  function AccuracyCell({ value }) {
    const color = value >= 80 ? C.easy : value >= 60 ? C.medium : C.hard;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 64, height: 4, background: C.container, borderRadius: 9999, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 9999 }} />
        </div>
        <span style={{ fontSize: 12, color: C.muted, fontFamily: "monospace" }}>{value}%</span>
      </div>
    );
  }

  function Row({ entry, rank, isCurrentUser }) {
    return (
      <tr
        style={{
          borderBottom: "1px solid #23232E",
          background: isCurrentUser ? "rgba(0,112,255,0.06)" : "transparent",
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => { if (!isCurrentUser) e.currentTarget.style.background = "rgba(42,42,44,0.3)"; }}
        onMouseLeave={(e) => { if (!isCurrentUser) e.currentTarget.style.background = "transparent"; }}
      >
        <td style={{ padding: "14px 16px", fontSize: 13, fontWeight: 700, color: isCurrentUser ? C.blue : C.muted, fontFamily: "monospace" }}>
          {rank}
        </td>
        <td style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
              background: isCurrentUser ? "rgba(0,112,255,0.15)" : C.container,
              border: `1px solid ${isCurrentUser ? "rgba(0,112,255,0.3)" : "#23232E"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700,
              color: isCurrentUser ? C.blue : C.muted,
            }}>
              {(entry.display_name || "?")[0].toUpperCase()}
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: isCurrentUser ? C.blue : "#fff" }}>
              {entry.display_name}
              {isCurrentUser && <span style={{ fontSize: 10, color: C.blue, marginLeft: 6 }}>(You)</span>}
            </span>
          </div>
        </td>
        <td style={{ padding: "14px 16px", fontSize: 13, fontWeight: 600, color: "#fff" }}>{entry.total_solved}</td>
        <td style={{ padding: "14px 16px", fontSize: 13, color: C.muted }}>{entry.total_submissions}</td>
        <td style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Number(entry.easy_solved)   > 0 && <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "rgba(34,197,94,0.1)",  color: C.easy,   border: "1px solid rgba(34,197,94,0.2)"  }}>{entry.easy_solved}E</span>}
            {Number(entry.medium_solved) > 0 && <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "rgba(245,158,11,0.1)", color: C.medium, border: "1px solid rgba(245,158,11,0.2)" }}>{entry.medium_solved}M</span>}
            {Number(entry.hard_solved)   > 0 && <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "rgba(244,63,94,0.1)",  color: C.hard,   border: "1px solid rgba(244,63,94,0.2)"  }}>{entry.hard_solved}H</span>}
          </div>
        </td>
        <td style={{ padding: "14px 16px" }}><AccuracyCell value={Number(entry.accuracy)} /></td>
        <td style={{ padding: "14px 16px", fontSize: 14, fontWeight: 800, color: isCurrentUser ? C.blue : "#fff" }}>
          {Number(entry.points).toLocaleString()}
        </td>
      </tr>
    );
  }

  return (
    <BentoCard style={{ overflow: "hidden", marginBottom: 24 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #23232E", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Global Rankings</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.muted }}>group</span>
          <span style={{ fontSize: 12, color: C.muted }}>{entries.length} participants</span>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(42,42,44,0.5)", borderBottom: "1px solid #23232E" }}>
            {["Rank", "User", "Solved", "Submissions", "Breakdown", "Accuracy", "Points"].map((h) => (
              <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.subtle, whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableEntries.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: "center", padding: 40, color: C.muted, fontSize: 13 }}>
                Not enough participants yet.
              </td>
            </tr>
          )}
          {tableEntries.map((entry, i) => (
            <Row key={entry.user_id} entry={entry} rank={i + 4} isCurrentUser={entry.user_id === currentUserId} />
          ))}

          {/* Sticky current-user row if they're in top 3 (shown in podium, not table) */}
          {showStickyRow && (
            <>
              <tr>
                <td colSpan={7} style={{ padding: "4px 16px", background: "rgba(42,42,44,0.2)" }}>
                  <span style={{ fontSize: 10, color: C.subtle }}>· · ·</span>
                </td>
              </tr>
              <Row entry={currentEntry} rank={currentUserRank} isCurrentUser />
            </>
          )}
        </tbody>
      </table>
    </BentoCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  const { user }                        = useAuth();
  const [entries, setEntries]           = useState([]);
  const [myProblems, setMyProblems]     = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [filterIdx, setFilterIdx]       = useState(2); // default: All Time

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchLeaderboard({ days: TIME_FILTERS[filterIdx].days }),
      fetchProblems({ userId: user.id }),
    ])
      .then(([lb, p]) => { setEntries(lb); setMyProblems(p); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, filterIdx]);

  const myStats = useMemo(() => {
    if (!user || entries.length === 0) return null;
    const entry  = entries.find((e) => e.user_id === user.id);
    const rank   = entries.findIndex((e) => e.user_id === user.id) + 1;
    const streak = calcStreak(myProblems);
    return entry ? { ...entry, rank, streak, total: entries.length } : null;
  }, [entries, myProblems, user]);

  if (loading) return <LoadingSpinner />;

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 32 }}>
        <div>
          <h2 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em", color: "#fff" }}>Global Leaderboard</h2>
          <p style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>Comparing performance across the LeetFlow network.</p>
        </div>

        {/* Time filter */}
        <div style={{ display: "flex", gap: 4, background: C.container, padding: 4, borderRadius: 8, border: "1px solid #23232E" }}>
          {TIME_FILTERS.map((f, i) => (
            <button key={f.label} onClick={() => setFilterIdx(i)} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: "none", cursor: "pointer", transition: "all 0.15s",
              background: filterIdx === i ? C.blue : "transparent",
              color:      filterIdx === i ? "#fff" : C.muted,
            }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", background: "rgba(147,0,10,0.2)", border: "1px solid rgba(147,0,10,0.4)", borderRadius: 8, color: "#ffb4ab", fontSize: 13, marginBottom: 24 }}>
          {error}
        </div>
      )}

      {entries.length >= 3 && <Podium entries={entries} currentUserId={user?.id} />}

      <RankingsTable entries={entries} currentUserId={user?.id} />

      {/* Current user stat strip */}
      {myStats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>

          <BentoCard style={{ padding: 20, display: "flex", alignItems: "center", gap: 16 }}>
            <span className="material-symbols-outlined" style={{ color: C.blue, fontSize: 22, fontVariationSettings: "'FILL' 1" }}>emoji_events</span>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted, marginBottom: 4 }}>Your Rank</p>
              <p style={{ fontSize: 24, fontWeight: 900, color: "#fff" }}>
                #{myStats.rank} <span style={{ fontSize: 13, color: C.muted, fontWeight: 400 }}>of {myStats.total}</span>
              </p>
            </div>
          </BentoCard>

          <BentoCard style={{ padding: 20, display: "flex", alignItems: "center", gap: 16 }}>
            <span className="material-symbols-outlined" style={{ color: "#ffb599", fontSize: 22, fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted, marginBottom: 4 }}>Active Streak</p>
              <p style={{ fontSize: 24, fontWeight: 900, color: "#fff" }}>
                {myStats.streak} <span style={{ fontSize: 13, color: C.muted, fontWeight: 400 }}>days</span>
              </p>
            </div>
          </BentoCard>

          <BentoCard style={{ padding: 20, display: "flex", alignItems: "center", gap: 16 }}>
            <span className="material-symbols-outlined" style={{ color: C.medium, fontSize: 22, fontVariationSettings: "'FILL' 1" }}>stars</span>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted, marginBottom: 4 }}>Your Points</p>
              <p style={{ fontSize: 24, fontWeight: 900, color: "#fff" }}>
                {Number(myStats.points).toLocaleString()} <span style={{ fontSize: 12, color: C.muted, fontWeight: 400 }}>pts</span>
              </p>
            </div>
          </BentoCard>

        </div>
      )}
    </div>
  );
}
