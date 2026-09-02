/**
 * Hook for fetching all dashboard analytics endpoints with auto-refresh.
 * Stage 4: Centralized Multi-District Analytics
 *
 * Endpoints:
 *  - /api/v1/dashboard/consignment-state
 *  - /api/v1/dashboard/delay-prediction
 *  - /api/v1/dashboard/fleet-summary
 *  - /api/v1/dashboard/reroute-audit?hours=24
 *  - /api/v1/dashboard/alert-log?limit=30
 */
import { useEffect, useState, useCallback, useRef } from 'react';

// Use a relative URL so requests route through the Vite dev proxy (no CORS).
const API_BASE = import.meta.env.VITE_API_URL || '';

export function useAnalytics({ enabled = true, refreshInterval = 30000 } = {}) {
  const [consignmentState, setConsignmentState] = useState(null);
  const [delayPrediction, setDelayPrediction] = useState(null);
  const [fleetSummary, setFleetSummary] = useState(null);
  const [rerouteAudit, setRerouteAudit] = useState(null);
  const [alertLog, setAlertLog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const fetchAll = useCallback(async () => {
    if (!enabled) return;
    try {
      setLoading(true);
      const fetchJson = async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.json();
      };

      const [cs, dp, fs, ra, al] = await Promise.all([
        fetchJson(`${API_BASE}/api/v1/dashboard/consignment-state`),
        fetchJson(`${API_BASE}/api/v1/dashboard/delay-prediction`),
        fetchJson(`${API_BASE}/api/v1/dashboard/fleet-summary`),
        fetchJson(`${API_BASE}/api/v1/dashboard/reroute-audit?hours=24`),
        fetchJson(`${API_BASE}/api/v1/dashboard/alert-log?limit=30`),
      ]);
      setConsignmentState(cs);
      setDelayPrediction(dp);
      setFleetSummary(fs);
      setRerouteAudit(ra);
      setAlertLog(al);
      setError(null);
    } catch (err) {
      console.error('[useAnalytics]', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchAll();
    pollRef.current = setInterval(fetchAll, refreshInterval);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [enabled, fetchAll, refreshInterval]);

  return {
    consignmentState,
    delayPrediction,
    fleetSummary,
    rerouteAudit,
    alertLog,
    loading,
    error,
    refetch: fetchAll,
  };
}
