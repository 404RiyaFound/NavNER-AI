/**
 * Fetch initial map state from the backend.
 */
import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export function useMapState() {
  const [vehicles, setVehicles] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchMapState() {
      try {
        const response = await fetch(`${API_URL}/api/v1/map-state`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        if (!cancelled) {
          setVehicles(data.vehicles || []);
          setIncidents(data.incidents || []);
          setLoading(false);
        }
      } catch (err) {
        console.error('[MapState] Fetch error:', err);
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    fetchMapState();
    return () => { cancelled = true; };
  }, []);

  return { vehicles, setVehicles, incidents, setIncidents, loading, error };
}
