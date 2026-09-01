/**
 * Hook for fetching fleet status and managing fleet trip data.
 * Polls GET /api/v1/routing/fleet-status and handles reroute events.
 */
import { useEffect, useState, useCallback, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export function useFleetStatus({ enabled = true, pollInterval = 15000 } = {}) {
  const [fleetData, setFleetData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const fetchFleet = useCallback(async () => {
    if (!enabled) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/v1/routing/fleet-status`);
      if (!res.ok) throw new Error(`Fleet status error: ${res.status}`);
      const data = await res.json();
      setFleetData(data);
      setError(null);
    } catch (err) {
      console.error('[useFleetStatus]', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  // Initial fetch + polling
  useEffect(() => {
    if (!enabled) return;
    fetchFleet();
    pollRef.current = setInterval(fetchFleet, pollInterval);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [enabled, fetchFleet, pollInterval]);

  // Handle reroute from WebSocket — update the specific trip in-place
  const handleRerouteAlert = useCallback((data) => {
    setFleetData(prev => {
      if (!prev) return prev;
      const updatedTrips = prev.active_trips.map(trip => {
        if (trip.trip_id === data.trip_id) {
          return {
            ...trip,
            status: 'REROUTED',
            delay_minutes: data.delay_minutes || 0,
            current_route: data.route_geojson || trip.current_route,
            estimated_arrival: data.new_eta || trip.estimated_arrival,
            last_rerouted_at: data.timestamp,
          };
        }
        return trip;
      });
      const rerouted = updatedTrips.filter(t => t.status === 'REROUTED').length;
      return {
        ...prev,
        active_trips: updatedTrips,
        rerouted_count: rerouted,
      };
    });
  }, []);

  // Trigger a manual reroute via API
  const triggerReroute = useCallback(async (tripId, avoidHazards = true, maxTolerance = 0.60) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/routing/calculate-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_id: tripId,
          avoid_hazards: avoidHazards,
          max_hazard_tolerance: maxTolerance,
        }),
      });
      if (!res.ok) throw new Error(`Reroute failed: ${res.status}`);
      const result = await res.json();
      // Refetch fleet data after reroute
      await fetchFleet();
      return result;
    } catch (err) {
      console.error('[useFleetStatus] Reroute error:', err);
      throw err;
    }
  }, [fetchFleet]);

  return {
    fleetData,
    loading,
    error,
    refetch: fetchFleet,
    handleRerouteAlert,
    triggerReroute,
  };
}
