/**
 * Hook for fetching all 4 dashboard analytics endpoints with auto-refresh.
 * Stage 4: Centralized Multi-District Analytics
 */
import { useEffect, useState, useCallback, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export function useAnalytics({ enabled = true, refreshInterval = 30000 } = {}) {
  const [consignmentState, setConsignmentState] = useState(null);
  const [delayPrediction, setDelayPrediction] = useState(null);
  const [fleetSummary, setFleetSummary] = useState(null);
  const [rerouteAudit, setRerouteAudit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const fetchAll = useCallback(async () => {
    if (!enabled) return;
    try {
      setLoading(true);
      const [cs, dp, fs, ra] = await Promise.all([
        fetch(`${API_BASE}/api/v1/dashboard/consignment-state`).then(r => r.json()),
        fetch(`${API_BASE}/api/v1/dashboard/delay-prediction`).then(r => r.json()),
        fetch(`${API_BASE}/api/v1/dashboard/fleet-summary`).then(r => r.json()),
        fetch(`${API_BASE}/api/v1/dashboard/reroute-audit?hours=24`).then(r => r.json()),
      ]);
      setConsignmentState(cs);
      setDelayPrediction(dp);
      setFleetSummary(fs);
      setRerouteAudit(ra);
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
    loading,
    error,
    refetch: fetchAll,
  };
}
