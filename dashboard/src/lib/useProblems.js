import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "../App.jsx";
import { fetchProblems } from "./dataProcessor.js";

const ProblemsContext = createContext(null);

// When the tab becomes visible again, refetch if the data is older than this,
// so solves synced by the extension in the meantime show up without a reload.
const REFRESH_AFTER_MS = 60_000;

/**
 * Loads the signed-in user's problems once and shares them with every page
 * (Layout wraps the routes in this provider).
 */
export function ProblemsProvider({ children }) {
  const { user } = useAuth();
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const lastLoadedAt = useRef(0);
  const latestRequest = useRef(0);

  const load = useCallback(async ({ background = false } = {}) => {
    if (!user) return;
    const request = ++latestRequest.current;
    if (!background) setLoading(true);
    try {
      const rows = await fetchProblems({ userId: user.id });
      if (request !== latestRequest.current) return; // a newer load started
      setProblems(rows);
      setError(null);
      lastLoadedAt.current = Date.now();
    } catch (err) {
      if (request !== latestRequest.current) return;
      setError(err?.message || String(err));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setProblems([]);
    load();
  }, [load]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && Date.now() - lastLoadedAt.current > REFRESH_AFTER_MS) {
        load({ background: true });
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [load]);

  const value = { problems, loading, error, refetch: load };
  return createElement(ProblemsContext.Provider, { value }, children);
}

/** { problems, loading, error, refetch } for the signed-in user. */
export function useProblems() {
  const ctx = useContext(ProblemsContext);
  if (!ctx) throw new Error("useProblems must be used inside <ProblemsProvider>");
  return ctx;
}
