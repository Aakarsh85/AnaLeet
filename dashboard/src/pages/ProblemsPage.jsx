import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "../App.jsx";
import { useProblems } from "../lib/useProblems.js";
import {
  generateInsights, buildTopicData, effectiveStatus, problemTitle, problemUrl, problemsToCsv,
} from "../lib/dataProcessor.js";
import { fetchBookmarks, addBookmark, removeBookmark } from "../lib/bookmarks.js";
import { BentoCard, DiffBadge, InsightCard, StatusBadge, ErrorBanner, C, LoadingSpinner } from "../components/UI.jsx";

const PAGE_SIZE = 15;

function downloadCsv(rows) {
  const blob = new Blob([problemsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leetflow-problems-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ProblemsPage() {
  const { user } = useAuth();
  const { problems, loading, error, refetch } = useProblems();
  const [bookmarks, setBookmarks] = useState(() => new Set());
  const [bookmarkError, setBookmarkError] = useState(null);
  const [search, setSearch] = useState("");
  const [diffFilter, setDiffFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!user) return;
    fetchBookmarks(user.id)
      .then((rows) => setBookmarks(new Set(rows.map((b) => b.problem_name))))
      .catch((e) => setBookmarkError(e.message));
  }, [user]);

  async function toggleBookmark(p) {
    const name = p.problem_name;
    const wasBookmarked = bookmarks.has(name);
    const next = new Set(bookmarks);
    if (wasBookmarked) next.delete(name); else next.add(name);
    setBookmarks(next); // optimistic
    try {
      if (wasBookmarked) await removeBookmark({ userId: user.id, problemName: name });
      else await addBookmark({ userId: user.id, problemName: name, difficulty: p.difficulty, tags: p.tags || [] });
      setBookmarkError(null);
    } catch (e) {
      setBookmarks(bookmarks); // revert
      setBookmarkError(e.message);
    }
  }

  const allTags = useMemo(() => {
    const set = new Set();
    problems.forEach(p => (p.tags || []).forEach(t => set.add(t)));
    return [...set].slice(0, 20);
  }, [problems]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return problems.filter(p => {
      if (term && !problemTitle(p).toLowerCase().includes(term) && !p.problem_name?.includes(term)) return false;
      if (diffFilter !== "all" && p.difficulty?.toLowerCase() !== diffFilter) return false;
      if (tagFilter && !(p.tags || []).includes(tagFilter)) return false;
      if (statusFilter !== "all" && effectiveStatus(p) !== statusFilter) return false;
      if (bookmarkedOnly && !bookmarks.has(p.problem_name)) return false;
      return true;
    });
  }, [problems, search, diffFilter, tagFilter, statusFilter, bookmarkedOnly, bookmarks]);

  const insights = useMemo(() => generateInsights(problems), [problems]);
  const topicData = useMemo(() => buildTopicData(problems), [problems]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  if (loading) return <LoadingSpinner />;

  const chip = (active) => ({
    padding: "4px 10px", borderRadius: 9999, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid", transition: "all 0.15s",
    background: active ? "rgba(0,112,255,0.2)" : "#23232E",
    color: active ? C.blue : "#6b7280",
    borderColor: active ? "rgba(0,112,255,0.3)" : "transparent",
  });

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h2 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em", color: "#fff" }}>Problem History</h2>
          <p style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
            <span style={{ color: C.blue, fontWeight: 700 }}>{problems.filter(p => p.status === "accepted").length}</span> accepted of {problems.length} tracked (one row per problem per day)
          </p>
        </div>
        <button
          onClick={() => downloadCsv(filtered)}
          disabled={filtered.length === 0}
          title="Download the rows matching the current filters"
          style={{ padding: "8px 16px", background: "#1c1b1d", border: "1px solid #23232E", borderRadius: 8, color: C.muted, fontSize: 13, fontWeight: 600, cursor: filtered.length ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: 8, opacity: filtered.length ? 1 : 0.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
          Export CSV
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refetch} />
      {bookmarkError && <ErrorBanner message={`Bookmarks: ${bookmarkError}`} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
        {/* Left: Filters + Table */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Filter bar */}
          <BentoCard style={{ padding: 16, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
              <span className="material-symbols-outlined" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280", fontSize: 16 }}>search</span>
              <input
                value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
                placeholder="Filter by name…"
                style={{ width: "100%", padding: "8px 12px 8px 36px", background: "#0e0e10", border: "1px solid #23232E", borderRadius: 8, color: "#e5e1e4", fontSize: 13, outline: "none" }}
                onFocus={e => e.target.style.borderColor = C.blue}
                onBlur={e => e.target.style.borderColor = "#23232E"}
              />
            </div>

            <select value={diffFilter} onChange={e => { setDiffFilter(e.target.value); setPage(0); }}
              style={{ padding: "8px 12px", background: "#0e0e10", border: "1px solid #23232E", borderRadius: 8, color: C.muted, fontSize: 13, outline: "none", cursor: "pointer" }}>
              <option value="all">All Difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>

            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
              style={{ padding: "8px 12px", background: "#0e0e10", border: "1px solid #23232E", borderRadius: 8, color: C.muted, fontSize: 13, outline: "none", cursor: "pointer" }}>
              <option value="all">All Status</option>
              <option value="accepted">Accepted</option>
              <option value="in_progress">In Progress</option>
              <option value="failed">Failed</option>
            </select>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => { setBookmarkedOnly(!bookmarkedOnly); setPage(0); }} style={{ ...chip(bookmarkedOnly), display: "flex", alignItems: "center", gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>bookmark</span>
                Bookmarked
              </button>
              {allTags.slice(0, 5).map(tag => (
                <button key={tag} onClick={() => { setTagFilter(tagFilter === tag ? "" : tag); setPage(0); }} style={chip(tagFilter === tag)}>
                  {tag}
                </button>
              ))}
            </div>
          </BentoCard>

          {/* Table */}
          <BentoCard style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(42,42,44,0.5)", borderBottom: "1px solid #23232E" }}>
                  {["Problem Name","Difficulty","Tags","Time Taken","Attempts","Status",""].map((h, i) => (
                    <th key={i} style={{ padding: "14px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6b7280", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: C.muted, fontSize: 13 }}>No problems match your filters.</td></tr>
                )}
                {paginated.map((p) => {
                  const mins = Math.floor((p.time_taken || 0) / 60);
                  const secs = ((p.time_taken || 0) % 60).toString().padStart(2, "0");
                  const isBookmarked = bookmarks.has(p.problem_name);
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid #23232E", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(42,42,44,0.3)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ color: "#6b7280", fontFamily: "monospace", fontSize: 11 }}>#</span>
                          <a href={problemUrl(p)} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 500, color: "#fff", textDecoration: "none" }}
                            onMouseEnter={e => e.currentTarget.style.color = C.blue}
                            onMouseLeave={e => e.currentTarget.style.color = "#fff"}>
                            {problemTitle(p)}
                          </a>
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px" }}><DiffBadge diff={p.difficulty} /></td>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(p.tags || []).slice(0, 3).map(tag => (
                            <span key={tag} style={{ fontSize: 10, color: "#6b7280", background: "#23232E", padding: "2px 6px", borderRadius: 4 }}>{tag}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px", fontFamily: "monospace", fontSize: 12, color: "#8c90a1" }}>{mins}m {secs}s</td>
                      <td style={{ padding: "14px 16px", fontSize: 13, color: "#8c90a1", textAlign: "center" }}>{p.attempts ?? 0}</td>
                      <td style={{ padding: "14px 16px" }}>
                        <StatusBadge status={effectiveStatus(p)} />
                      </td>
                      <td style={{ padding: "14px 8px" }}>
                        <button onClick={() => toggleBookmark(p)} title={isBookmarked ? "Remove bookmark" : "Bookmark for retry"}
                          style={{ background: "transparent", border: "none", cursor: "pointer", color: isBookmarked ? C.medium : "#424655", display: "flex" }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: isBookmarked ? "'FILL' 1" : "'FILL' 0" }}>bookmark</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(42,42,44,0.2)", borderTop: "1px solid #23232E" }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Showing {Math.min(paginated.length, PAGE_SIZE)} of {filtered.length} results</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ padding: "4px 8px", background: "#23232E", border: "none", borderRadius: 4, color: page === 0 ? "#424655" : "#e5e1e4", cursor: page === 0 ? "not-allowed" : "pointer" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_left</span>
                </button>
                <span style={{ fontSize: 12, color: C.muted, padding: "6px 8px" }}>{page + 1} / {Math.max(1, totalPages)}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  style={{ padding: "4px 8px", background: "#23232E", border: "none", borderRadius: 4, color: page >= totalPages - 1 ? "#424655" : "#e5e1e4", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_right</span>
                </button>
              </div>
            </div>
          </BentoCard>
        </div>

        {/* Right: Insights + Topic Mastery */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <BentoCard style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <span className="material-symbols-outlined" style={{ color: C.blue, fontVariationSettings: "'FILL' 1" }}>insights</span>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Smart Insights</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
            </div>
          </BentoCard>

          <BentoCard style={{ padding: 24, flex: 1 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6b7280", marginBottom: 20 }}>Topic Mastery</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {topicData.slice(0, 6).map((t) => (
                <div key={t.tag}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: "#e5e1e4" }}>{t.tag}</span>
                    <span style={{ color: C.blue, fontWeight: 700 }}>{t.successRate}%</span>
                  </div>
                  <div style={{ height: 4, background: "#353437", borderRadius: 9999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${t.successRate}%`, background: C.blue, boxShadow: `0 0 10px rgba(0,112,255,0.5)`, transition: "width 0.6s ease" }} />
                  </div>
                </div>
              ))}
              {topicData.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>Tag your problems to see mastery.</p>}
            </div>
          </BentoCard>
        </div>
      </div>
    </div>
  );
}
