import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../App.jsx";
import { fetchProblems, fetchSessions } from "./dataProcessor.js";

/**
 * Central data hook — fetches problems + sessions once and provides
 * a refresh callback. Consumed by Dashboard, Problems, and Analytics pages.
 */
export function useProblems({ dateFrom, dateTo } = {}) {
  const { user } = useAuth();
  const [problems, setProblems] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([
        fetchProblems({ userId: user.id, from: dateFrom, to: dateTo }),
        fetchSessions({ userId: user.id }),
      ]);
      setProblems(p);
      setSessions(s);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return { problems, sessions, loading, error, refetch: load };
}
