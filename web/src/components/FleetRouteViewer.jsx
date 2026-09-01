/**
 * FleetRouteViewer — Renders original + rerouted route paths on the map
 * with animated vehicle markers and a floating status card.
 *
 * Stage 3: Multi-Route Path Renderer
 * - Original route: dashed red line
 * - Rerouted path: bold green line
 * - Floating glassmorphism card with trip info + Accept/Revert buttons
 */
import { useEffect, useRef, useState, useCallback } from 'react';

const ROUTE_SOURCE_PREFIX = 'fleet-route-';
const ORIGINAL_LAYER_PREFIX = 'fleet-original-';
const ACTIVE_LAYER_PREFIX = 'fleet-active-';

export function FleetRouteViewer({ map, fleetData, selectedTripId, onSelectTrip, onAcceptRoute, onRevertRoute }) {
  const layerIdsRef = useRef(new Set());
  const sourceIdsRef = useRef(new Set());
  const [selectedTrip, setSelectedTrip] = useState(null);

  // Find selected trip data
  useEffect(() => {
    if (!fleetData?.active_trips || !selectedTripId) {
      setSelectedTrip(null);
      return;
    }
    const trip = fleetData.active_trips.find(t => t.trip_id === selectedTripId);
    setSelectedTrip(trip || null);
  }, [fleetData, selectedTripId]);

  // Render route lines on the map
  useEffect(() => {
    if (!map || !fleetData?.active_trips) return;

    // Wait for map style to load
    if (!map.isStyleLoaded()) {
      const handler = () => renderRoutes();
      map.once('styledata', handler);
      return () => map.off('styledata', handler);
    }

    renderRoutes();

    function renderRoutes() {
      // Clean up old layers/sources
      for (const layerId of layerIdsRef.current) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      for (const sourceId of sourceIdsRef.current) {
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
      layerIdsRef.current.clear();
      sourceIdsRef.current.clear();

      fleetData.active_trips.forEach((trip) => {
        const tripKey = trip.trip_id.slice(0, 8);

        // Original route (dashed red)
        if (trip.original_route && trip.original_route.coordinates?.length > 1) {
          const origSourceId = `${ROUTE_SOURCE_PREFIX}orig-${tripKey}`;
          const origLayerId = `${ORIGINAL_LAYER_PREFIX}${tripKey}`;

          map.addSource(origSourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: trip.original_route.coordinates,
              },
            },
          });

          map.addLayer({
            id: origLayerId,
            type: 'line',
            source: origSourceId,
            paint: {
              'line-color': '#ef4444',
              'line-width': 3,
              'line-opacity': trip.trip_id === selectedTripId ? 0.7 : 0.35,
              'line-dasharray': [3, 3],
            },
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
          });

          sourceIdsRef.current.add(origSourceId);
          layerIdsRef.current.add(origLayerId);
        }

        // Active/rerouted route (solid green)
        if (trip.current_route && trip.current_route.coordinates?.length > 1) {
          const activeSourceId = `${ROUTE_SOURCE_PREFIX}active-${tripKey}`;
          const activeLayerId = `${ACTIVE_LAYER_PREFIX}${tripKey}`;

          map.addSource(activeSourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: trip.current_route.coordinates,
              },
            },
          });

          // Use different color based on whether this is the selected trip
          const isSelected = trip.trip_id === selectedTripId;
          const lineColor = trip.status === 'REROUTED' ? '#22c55e' : '#3b82f6';

          map.addLayer({
            id: activeLayerId,
            type: 'line',
            source: activeSourceId,
            paint: {
              'line-color': lineColor,
              'line-width': isSelected ? 5 : 3.5,
              'line-opacity': isSelected ? 1.0 : 0.65,
            },
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
          });

          sourceIdsRef.current.add(activeSourceId);
          layerIdsRef.current.add(activeLayerId);
        }
      });
    }

    // Cleanup on unmount
    return () => {
      for (const layerId of layerIdsRef.current) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      for (const sourceId of sourceIdsRef.current) {
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
    };
  }, [map, fleetData, selectedTripId]);

  if (!selectedTrip) return null;

  // Status label
  const getStatusLabel = (trip) => {
    if (trip.status === 'REROUTED') {
      const delay = trip.delay_minutes;
      return delay ? `Rerouted (+${delay}m)` : 'Rerouted';
    }
    if (trip.status === 'IN_TRANSIT') return 'On Route';
    if (trip.status === 'PENDING') return 'Pending';
    return trip.status;
  };

  // Priority badge config
  const priorityConfig = {
    EMERGENCY: { emoji: '🔴', label: 'Emergency', class: 'priority-emergency' },
    HIGH_PRIORITY: { emoji: '🟠', label: 'High Priority', class: 'priority-high' },
    STANDARD: { emoji: '🔵', label: 'Standard', class: 'priority-standard' },
  };

  // Commodity display
  const commodityLabels = {
    MEDICINE: '💊 Medicine',
    FOOD_GRAINS: '🌾 Food Grains',
    FUEL: '⛽ Fuel',
    GENERAL: '📦 General',
  };

  const prio = priorityConfig[selectedTrip.priority_level] || priorityConfig.STANDARD;
  const commodityLabel = commodityLabels[selectedTrip.commodity_type] || '📦 General';
  const statusLabel = getStatusLabel(selectedTrip);
  const isRerouted = selectedTrip.status === 'REROUTED';

  return (
    <div className="fleet-route-card" id="fleet-route-card">
      <div className="fleet-route-card-header">
        <div className="fleet-route-card-title">
          <span className="fleet-route-vehicle-name">🚛 {selectedTrip.vehicle_name}</span>
          <span className={`fleet-route-priority-badge ${prio.class}`}>
            {prio.emoji} {prio.label}
          </span>
        </div>
        <button
          className="fleet-route-card-close"
          onClick={() => onSelectTrip?.(null)}
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="fleet-route-card-body">
        <div className="fleet-route-info-row">
          <span className="fleet-route-label">Commodity</span>
          <span className="fleet-route-value">{commodityLabel}</span>
        </div>
        <div className="fleet-route-info-row">
          <span className="fleet-route-label">Route</span>
          <span className="fleet-route-value">{selectedTrip.origin_name} → {selectedTrip.dest_name}</span>
        </div>
        <div className="fleet-route-info-row">
          <span className="fleet-route-label">Status</span>
          <span className={`fleet-route-status-badge ${isRerouted ? 'rerouted' : 'on-route'}`}>
            {statusLabel}
          </span>
        </div>
        {selectedTrip.estimated_arrival && (
          <div className="fleet-route-info-row">
            <span className="fleet-route-label">ETA</span>
            <span className="fleet-route-value">
              {new Date(selectedTrip.estimated_arrival).toLocaleString()}
            </span>
          </div>
        )}
        {isRerouted && selectedTrip.delay_minutes && (
          <div className="fleet-route-delay-banner">
            ⚠️ Estimated delay: <strong>+{selectedTrip.delay_minutes} minutes</strong>
          </div>
        )}
      </div>

      <div className="fleet-route-card-actions">
        {isRerouted && (
          <>
            <button
              className="fleet-action-btn accept"
              onClick={() => onAcceptRoute?.(selectedTrip.trip_id)}
            >
              ✓ Accept Route
            </button>
            <button
              className="fleet-action-btn revert"
              onClick={() => onRevertRoute?.(selectedTrip.trip_id)}
            >
              ↩ Revert
            </button>
          </>
        )}
        {!isRerouted && (
          <button
            className="fleet-action-btn recalc"
            onClick={() => onAcceptRoute?.(selectedTrip.trip_id)}
          >
            🔄 Recalculate Route
          </button>
        )}
      </div>
    </div>
  );
}
