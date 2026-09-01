/**
 * Custom hook to fetch hazard GeoJSON from the analytics API.
 * Supports filtering by district and minimum risk score, with auto-refresh.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// Use a relative URL so requests route through the Vite dev proxy (no CORS).
const API_URL = import.meta.env.VITE_API_URL || '';
const REFRESH_INTERVAL = 120_000; // 2 minutes

export function useHazardMap({ district = null, minRisk = 0, enabled = true } = {}) {
  const [hazardData, setHazardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const fetchHazardMap = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (district) params.set('district', district);
      if (minRisk > 0) params.set('min_risk', String(minRisk));

      const qs = params.toString();
      const url = `${API_URL}/api/v1/analytics/hazard-map${qs ? `?${qs}` : ''}`;
      const response = await fetch(url);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      setHazardData(data);
    } catch (err) {
      console.error('[HazardMap] Fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [district, minRisk, enabled]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchHazardMap();

    if (enabled) {
      intervalRef.current = setInterval(fetchHazardMap, REFRESH_INTERVAL);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchHazardMap, enabled]);

  return { hazardData, loading, error, refetch: fetchHazardMap };
}
