/**
 * useOSRMRoutes — Enriches fleet data with real road-snapped route geometry
 * by calling the OSRM public routing API (no API key needed).
 *
 * Problem: The stored route geometries in the backend DB may be straight-line
 * displacement paths rather than actual road-following polylines.
 *
 * Fix strategy:
 *  1. Detect displacement / low-quality routes using a COLLINEARITY test
 *     (pure point-count threshold is unreliable — the DynamicGraphRouter can
 *     produce routes with 10-30 intermediate nodes that are still nearly straight)
 *  2. For any trip that needs enrichment, resolve its origin+dest coords:
 *     a. Prefer the backend-supplied origin_lat/lng / dest_lat/lng
 *     b. Fallback: use first+last coords of the stored route itself
 *     c. Fallback: skip (log a warning)
 *  3. Call OSRM with the resolved coords and cache the result
 *
 * OSRM: https://router.project-osrm.org — free, no API key, OSM-powered.
 */
import { useState, useEffect, useRef } from 'react';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

// In-memory cache: "lng1,lat1;lng2,lat2" → { primary, alternative }
const routeCache = new Map();

// ---------------------------------------------------------------------------
// Collinearity / displacement detection
// ---------------------------------------------------------------------------

/**
 * Measure how "straight" a polyline is by computing the maximum perpendicular
 * deviation of any point from the straight line between the first and last point,
 * normalised by the total straight-line distance between endpoints.
 *
 * Returns a value in [0, ∞):
 *   0   = perfectly straight line
 *   0.1 = slight curves (long rural roads)
 *   0.3+ = clearly road-following with turns
 *
 * We treat anything below STRAIGHTNESS_THRESHOLD as a displacement path.
 */
function maxRelativeDeviation(coords) {
  if (!coords || coords.length < 2) return 0;
  const [x0, y0] = coords[0];
  const [x1, y1] = coords[coords.length - 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const denom = Math.sqrt(dx * dx + dy * dy);
  if (denom < 1e-9) return 0; // origin === dest

  let maxDev = 0;
  for (const [x, y] of coords) {
    // Perpendicular distance from point to the endpoint line
    const dev = Math.abs(dy * x - dx * y + x1 * y0 - y1 * x0) / denom;
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev / denom; // relative to the total displacement length
}

/**
 * Returns true if the route should be replaced with OSRM geometry.
 * We use a combined heuristic:
 *   - Fewer than MIN_POINTS → definitely displacement
 *   - maxRelativeDeviation < STRAIGHTNESS_THRESHOLD → nearly straight line
 *
 * MIN_POINTS = 30: real NE India 50–200km routes from OSRM have 100–500 points;
 * even the DynamicGraphRouter gives 15–40, so 30 is a safe threshold below
 * which we know the route hasn't been properly snapped.
 *
 * STRAIGHTNESS_THRESHOLD = 0.08: anything below this (< 8% max deviation
 * relative to total displacement) is suspiciously straight for mountainous NE India.
 */
const MIN_POINTS            = 30;
const STRAIGHTNESS_THRESHOLD = 0.08;

function isDisplacementPath(coords) {
  if (!coords || coords.length < 2)        return true;
  if (coords.length < MIN_POINTS)           return true;
  if (maxRelativeDeviation(coords) < STRAIGHTNESS_THRESHOLD) return true;
  return false;
}

// ---------------------------------------------------------------------------
// OSRM fetch
// ---------------------------------------------------------------------------

async function fetchOSRMRoute(originLng, originLat, destLng, destLat) {
  const cacheKey = `${originLng.toFixed(5)},${originLat.toFixed(5)};${destLng.toFixed(5)},${destLat.toFixed(5)}`;
  if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);

  const url =
    `${OSRM_BASE}/${originLng},${originLat};${destLng},${destLat}` +
    `?overview=full&geometries=geojson&alternatives=true&steps=false`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);

  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) {
    throw new Error(`OSRM no route (code=${json.code})`);
  }

  const primary     = json.routes[0].geometry.coordinates;
  const alternative = json.routes[1]?.geometry?.coordinates ?? null;

  const result = { primary, alternative };
  routeCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Coordinate resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the origin and destination coordinates for a trip.
 * Preference order:
 *   1. Backend-provided origin_lat/lng & dest_lat/lng (most accurate)
 *   2. First/last coords of the stored route (works even if backend missing)
 *   3. null (cannot route — skip)
 */
function resolveCoords(trip) {
  // Option 1: backend-supplied explicit coords
  if (
    trip.origin_lat != null && trip.origin_lng != null &&
    trip.dest_lat   != null && trip.dest_lng   != null
  ) {
    return {
      originLng: trip.origin_lng, originLat: trip.origin_lat,
      destLng:   trip.dest_lng,   destLat:   trip.dest_lat,
    };
  }

  // Option 2: first+last coords of stored route
  const coords = trip.current_route?.coordinates;
  if (coords?.length >= 2) {
    const [oLng, oLat] = coords[0];
    const [dLng, dLat] = coords[coords.length - 1];
    return { originLng: oLng, originLat: oLat, destLng: dLng, destLat: dLat };
  }

  return null; // cannot resolve
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOSRMRoutes(fleetData) {
  const [enrichedFleet, setEnrichedFleet] = useState(null);
  const fetchedRef     = useRef(new Set());
  const prevTripIdsRef = useRef('');

  useEffect(() => {
    if (!fleetData?.active_trips?.length) {
      setEnrichedFleet(fleetData);
      return;
    }

    // Reset tracking when the trip set changes (e.g. after reroute)
    const tripIdKey = fleetData.active_trips.map(t => t.trip_id).sort().join(',');
    if (tripIdKey !== prevTripIdsRef.current) {
      prevTripIdsRef.current = tripIdKey;
      fetchedRef.current = new Set();
    }

    // Baseline: start with raw data while OSRM fetches run
    setEnrichedFleet(prev =>
      prev?._source_key === tripIdKey
        ? prev
        : { ...fleetData, _source_key: tripIdKey }
    );

    // Identify which trips need real routing
    const tripsToFetch = fleetData.active_trips.filter(trip => {
      if (fetchedRef.current.has(trip.trip_id)) return false;
      return isDisplacementPath(trip.current_route?.coordinates);
    });

    if (!tripsToFetch.length) return;

    const fetchAll = async () => {
      const jobs = tripsToFetch.map(async trip => {
        const coords = resolveCoords(trip);
        if (!coords) {
          console.warn(`[useOSRMRoutes] No coords for trip ${trip.vehicle_name} — skipping`);
          fetchedRef.current.add(trip.trip_id);
          return null;
        }

        try {
          const result = await fetchOSRMRoute(
            coords.originLng, coords.originLat,
            coords.destLng,   coords.destLat,
          );
          fetchedRef.current.add(trip.trip_id);
          console.info(
            `[useOSRMRoutes] Enriched ${trip.vehicle_name}: ` +
            `${result.primary.length} road points (was ${trip.current_route?.coordinates?.length ?? 0})`
          );
          return { trip_id: trip.trip_id, ...result };
        } catch (err) {
          console.warn(`[useOSRMRoutes] OSRM failed for ${trip.vehicle_name}:`, err.message);
          fetchedRef.current.add(trip.trip_id);
          return null;
        }
      });

      const settled = (await Promise.allSettled(jobs))
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);

      if (!settled.length) return;

      const routeMap = Object.fromEntries(settled.map(r => [r.trip_id, r]));

      setEnrichedFleet(prev => {
        if (!prev) return prev;

        const updatedTrips = prev.active_trips.map(trip => {
          const update = routeMap[trip.trip_id];
          if (!update) return trip;

          const enriched = { ...trip };

          // Replace current route with OSRM primary (road-snapped)
          enriched.current_route = {
            type:          'LineString',
            coordinates:   update.primary,
            _osrm_enriched: true,
          };

          // For REROUTED trips: if original route is also a displacement path,
          // show the OSRM alternative as the "blocked road" (dashed red).
          if (trip.status === 'REROUTED') {
            const origCoords = trip.original_route?.coordinates;
            if (isDisplacementPath(origCoords) && update.alternative) {
              enriched.original_route = {
                type:          'LineString',
                coordinates:   update.alternative,
                _osrm_enriched: true,
              };
            }
          }

          return enriched;
        });

        return { ...prev, active_trips: updatedTrips };
      });
    };

    fetchAll();
  }, [fleetData]);

  return enrichedFleet ?? fleetData;
}
