/**
 * FleetRouteViewer — Renders the BLOCKED (original) route overlay on the map.
 *
 * The colored active/current route is rendered by HazardRouteColorizer.
 * This component's sole job is to draw the dashed red "blocked path" line
 * when a trip has been REROUTED — clearly showing what road segment is
 * avoided. This matches the reference image from Issue #63.
 */
import { useEffect, useRef } from 'react';

const BLOCKED_SOURCE_PREFIX = 'frv-blocked-source-';
const BLOCKED_LAYER_PREFIX  = 'frv-blocked-layer-';
const BLOCKED_CASING_PREFIX = 'frv-blocked-casing-';

export function FleetRouteViewer({ map, fleetData, selectedTripId }) {
  const layerIdsRef  = useRef(new Set());
  const sourceIdsRef = useRef(new Set());

  useEffect(() => {
    if (!map || !fleetData?.active_trips) return;

    const renderBlocked = () => {
      // Clean up previous layers
      for (const id of layerIdsRef.current) {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {}
      }
      for (const id of sourceIdsRef.current) {
        try { if (map.getSource(id)) map.removeSource(id); } catch (_) {}
      }
      layerIdsRef.current.clear();
      sourceIdsRef.current.clear();

      fleetData.active_trips.forEach(trip => {
        // Only render the blocked route for REROUTED trips that have an original route
        if (trip.status !== 'REROUTED') return;
        if (!trip.original_route?.coordinates?.length || trip.original_route.coordinates.length < 2) return;

        const tripKey    = trip.trip_id.slice(0, 8);
        const isSelected = trip.trip_id === selectedTripId;
        const dimmed     = Boolean(selectedTripId) && !isSelected;
        const opacity    = dimmed ? 0.04 : (isSelected ? 0.65 : 0.22);
        const lineWidth  = isSelected ? 4 : 2;

        const srcId    = `${BLOCKED_SOURCE_PREFIX}${tripKey}`;
        const casingId = `${BLOCKED_CASING_PREFIX}${tripKey}`;
        const layerId  = `${BLOCKED_LAYER_PREFIX}${tripKey}`;

        map.addSource(srcId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: { status: 'BLOCKED' },
            geometry: {
              type: 'LineString',
              coordinates: trip.original_route.coordinates,
            },
          },
        });
        sourceIdsRef.current.add(srcId);

        // Subtle casing so the dashed red stands out from the basemap
        map.addLayer({
          id: casingId, type: 'line', source: srcId,
          paint: {
            'line-color': '#7f1d1d',
            'line-width': lineWidth + 3,
            'line-opacity': opacity * 0.35,
          },
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
        });
        layerIdsRef.current.add(casingId);

        // Dashed red line — signals "this path is blocked / avoided"
        map.addLayer({
          id: layerId, type: 'line', source: srcId,
          paint: {
            'line-color': '#ef4444',
            'line-width': lineWidth,
            'line-opacity': opacity,
            'line-dasharray': [3, 4],
          },
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
        });
        layerIdsRef.current.add(layerId);
      });
    };

    let cancelled = false;
    let pollTimer = null;

    const tryRender = () => {
      if (cancelled) return;
      if (map.isStyleLoaded()) {
        renderBlocked();
      } else {
        pollTimer = setTimeout(tryRender, 300);
      }
    };

    tryRender();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      for (const id of layerIdsRef.current) {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {}
      }
      for (const id of sourceIdsRef.current) {
        try { if (map.getSource(id)) map.removeSource(id); } catch (_) {}
      }
    };
  }, [map, fleetData, selectedTripId]);

  return null;
}
