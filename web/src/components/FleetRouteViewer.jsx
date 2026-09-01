/**
 * FleetRouteViewer — Renders original + rerouted route paths on the map
 * Orange active route (logistics mockup style), animated dashes for rerouted.
 * Stage 3: Multi-Route Path Renderer
 */
import { useEffect, useRef } from 'react';

const ROUTE_SOURCE_PREFIX = 'fleet-route-';
const ORIGINAL_LAYER_PREFIX = 'fleet-original-';
const ACTIVE_LAYER_PREFIX = 'fleet-active-';
const ACTIVE_CASING_PREFIX = 'fleet-active-casing-';

export function FleetRouteViewer({ map, fleetData, selectedTripId }) {
  const layerIdsRef = useRef(new Set());
  const sourceIdsRef = useRef(new Set());

  // Render route lines on the map
  useEffect(() => {
    if (!map || !fleetData?.active_trips) return;

    const renderRoutes = () => {
      // Clean up old layers/sources
      for (const layerId of layerIdsRef.current) {
        try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch(_) {}
      }
      for (const sourceId of sourceIdsRef.current) {
        try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch(_) {}
      }
      layerIdsRef.current.clear();
      sourceIdsRef.current.clear();

      fleetData.active_trips.forEach((trip) => {
        const tripKey = trip.trip_id.slice(0, 8);
        const isSelected = trip.trip_id === selectedTripId;
        // With a trip selected, its route is drawn bold and the rest pushed
        // right back, so "which route is this truck on" is answerable at a glance.
        const dimmed = Boolean(selectedTripId) && !isSelected;
        const isRerouted = trip.status === 'REROUTED';

        // Original route — red, meaning "blocked". Only drawn when the trip was
        // actually rerouted: for a trip still on its original path the original
        // and current routes are the same line, and painting it red would signal
        // a blockage that does not exist.
        if (isRerouted && trip.original_route && trip.original_route.coordinates?.length > 1) {
          const origSourceId = `${ROUTE_SOURCE_PREFIX}orig-${tripKey}`;
          const origLayerId = `${ORIGINAL_LAYER_PREFIX}${tripKey}`;

          map.addSource(origSourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: trip.original_route.coordinates },
            },
          });

          map.addLayer({
            id: origLayerId,
            type: 'line',
            source: origSourceId,
            paint: {
              'line-color': '#ef4444',
              'line-width': isSelected ? 3 : 1.5,
              'line-opacity': dimmed ? 0.08 : (isSelected ? 0.75 : 0.25),
              'line-dasharray': [4, 4],
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });

          sourceIdsRef.current.add(origSourceId);
          layerIdsRef.current.add(origLayerId);
        }

        // Active/current route
        if (trip.current_route && trip.current_route.coordinates?.length > 1) {
          const activeSourceId = `${ROUTE_SOURCE_PREFIX}active-${tripKey}`;
          const activeLayerId = `${ACTIVE_LAYER_PREFIX}${tripKey}`;
          const casingLayerId = `${ACTIVE_CASING_PREFIX}${tripKey}`;

          map.addSource(activeSourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: trip.current_route.coordinates },
            },
          });

          // Casing (halo) layer underneath — gives the thick bordered look
          map.addLayer({
            id: casingLayerId,
            type: 'line',
            source: activeSourceId,
            paint: {
              // Casing is a darker shade of the clear-route green.
              'line-color': '#16a34a',
              'line-width': isSelected ? 12 : 6,
              'line-opacity': dimmed ? 0 : (isSelected ? 0.55 : 0.18),
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });

          // Green means the corridor is clear and usable; the red original above
          // means blocked. The route in use is always green, whether or not it
          // was reached by a reroute.
          const lineColor = '#22c55e';

          map.addLayer({
            id: activeLayerId,
            type: 'line',
            source: activeSourceId,
            paint: {
              'line-color': lineColor,
              'line-width': isSelected ? 7 : 3,
              'line-opacity': dimmed ? 0.22 : 1.0,
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });

          sourceIdsRef.current.add(activeSourceId);
          layerIdsRef.current.add(casingLayerId);
          layerIdsRef.current.add(activeLayerId);
        }
    });
    }; // end renderRoutes

    // Poll until the style is queryable, then add the layers.
    //
    // This deliberately does not gate on `map.loaded()`. The map only reaches
    // this component via onMapReady, which fires inside map.on('load') — so
    // 'load' has already happened. `map.loaded()` also reports false while any
    // tiles are still in flight. The previous code read that as "not loaded
    // yet" and waited on map.once('load', ...) for an event that had already
    // fired, so no route layer was ever added.
    let cancelled = false;
    let pollTimer = null;

    const tryRender = () => {
      if (cancelled) return;
      if (map.isStyleLoaded()) {
        renderRoutes();
      } else {
        pollTimer = setTimeout(tryRender, 300);
      }
    };

    tryRender();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      for (const layerId of layerIdsRef.current) {
        try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch(_) {}
      }
      for (const sourceId of sourceIdsRef.current) {
        try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch(_) {}
      }
    };
  }, [map, fleetData, selectedTripId]);

  return null; // purely map-based rendering
}
