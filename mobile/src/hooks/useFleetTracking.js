/**
 * Live fleet tracking from the real NavNER backend (issue #68 §1).
 *
 * Replaces the mock fleet MapScreen used to run on. mockFleet.js jittered
 * hardcoded positions locally and the "route" shown on selection was three
 * points offset from the truck's own coordinates — never real geometry.
 *
 * Merges GET /api/v1/map-state (vehicle positions) with
 * GET /api/v1/routing/fleet-status (trip/commodity/ETA/route detail), since
 * neither endpoint alone carries everything the bottom sheet needs. Polls
 * rather than opening a second WebSocket client: this screen's own polling
 * interval already matches the web dashboard's fleet-status refresh
 * cadence, and one more long-lived socket on a field officer's already
 * marginal connection is a cost worth avoiding for a screen that does not
 * need sub-second updates.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
const POLL_MS = 5000;

const COMMODITY_ICON = {
  MEDICINE: '💊',
  FOOD_GRAINS: '🌾',
  FUEL: '⛽',
  GENERAL: '📦',
};

function toTruck(vehicle, trip) {
  return {
    id: vehicle.license_plate || vehicle.name || vehicle.id,
    vehicleId: vehicle.id,
    // No per-driver identity exists in the data model — showing a fabricated
    // name here was exactly the kind of invented data this pass removes, so
    // this is the vehicle's real organization instead, or nothing.
    organization: trip?.organization || vehicle.organization || null,
    cargo: trip ? trip.commodity_type.replace(/_/g, ' ') : '—',
    cargoIcon: trip ? (COMMODITY_ICON[trip.commodity_type] || '📦') : '🚛',
    status: trip?.status || vehicle.status?.toUpperCase() || 'UNKNOWN',
    rerouted: trip?.status === 'REROUTED',
    // Real minutes of schedule variance from the routing engine, not a
    // fabricated 0-100 "delay risk" score — there is no per-vehicle
    // probability endpoint to draw one from honestly.
    delayMinutes: trip?.delay_minutes ?? null,
    eta: trip?.estimated_arrival
      ? new Date(trip.estimated_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '—',
    route: trip ? `${trip.origin_name} → ${trip.dest_name}` : 'No active trip',
    lat: vehicle.lat,
    lng: vehicle.lng,
    // GeoJSON LineString coordinates are [lng, lat]; react-native-maps wants
    // {latitude, longitude} — converted once here rather than in the render
    // path of every marker.
    currentRoute: trip?.current_route?.coordinates?.map(([lng, lat]) => ({
      latitude: lat, longitude: lng,
    })) ?? null,
    originalRoute: trip?.original_route?.coordinates?.map(([lng, lat]) => ({
      latitude: lat, longitude: lng,
    })) ?? null,
  };
}

export function useFleetTracking({ enabled = true } = {}) {
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const fetchOnce = useCallback(async () => {
    try {
      const [mapRes, fleetRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/map-state`),
        fetch(`${API_URL}/api/v1/routing/fleet-status`),
      ]);
      if (!mapRes.ok) throw new Error(`map-state ${mapRes.status}`);
      if (!fleetRes.ok) throw new Error(`fleet-status ${fleetRes.status}`);

      const mapState = await mapRes.json();
      const fleetStatus = await fleetRes.json();

      const tripByVehicle = new Map(
        (fleetStatus.active_trips || []).map((t) => [t.vehicle_id, t]),
      );

      const withPosition = (mapState.vehicles || []).filter(
        (v) => v.lat != null && v.lng != null,
      );
      setTrucks(withPosition.map((v) => toTruck(v, tripByVehicle.get(v.id))));
      setError(null);
    } catch (err) {
      // The map must not silently keep showing a stale fleet as if it were
      // current — the caller renders `error` rather than swallowing it,
      // which is the same failure mode issue #20 was about on the web side.
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchOnce();
    pollRef.current = setInterval(fetchOnce, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [enabled, fetchOnce]);

  return { trucks, loading, error, refetch: fetchOnce };
}
