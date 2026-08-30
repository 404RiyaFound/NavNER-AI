/**
 * Full-screen MapLibre GL canvas centered on North Eastern Region.
 * Renders vehicle and incident markers with popups.
 */
import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Emoji icons by type
const VEHICLE_EMOJI = { truck: '🚛', ambulance: '🚑', utility: '🔧' };
const INCIDENT_EMOJI = { flood: '🌊', landslide: '⛰️', road_damage: '🚧', bridge_collapse: '🌉' };

export function MapCanvas({ vehicles, incidents, onIncidentClick }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const vehicleMarkersRef = useRef({});
  const incidentMarkersRef = useRef({});

  // Initialize map once
  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: [
              'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          }
        },
        layers: [
          {
            id: 'osm-tiles-layer',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19
          }
        ]
      },
      center: [93.0, 26.2],  // North Eastern Region center
      zoom: 6.5,
      minZoom: 4,
      maxZoom: 18,
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 200 }), 'bottom-left');

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update vehicle markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old markers that no longer exist
    const currentIds = new Set(vehicles.map(v => v.id));
    for (const [id, marker] of Object.entries(vehicleMarkersRef.current)) {
      if (!currentIds.has(id)) {
        marker.remove();
        delete vehicleMarkersRef.current[id];
      }
    }

    // Add/update vehicle markers
    vehicles.forEach(vehicle => {
      if (vehicle.lat == null || vehicle.lng == null) return;

      const existing = vehicleMarkersRef.current[vehicle.id];
      if (existing) {
        // Update position
        existing.setLngLat([vehicle.lng, vehicle.lat]);
        return;
      }

      // Create marker DOM element
      const el = document.createElement('div');
      el.className = `marker-vehicle ${vehicle.type}`;
      el.innerHTML = VEHICLE_EMOJI[vehicle.type] || '🚛';
      el.title = vehicle.name;

      // Create popup
      const popup = new maplibregl.Popup({ offset: 25, closeButton: false })
        .setHTML(`
          <div class="map-popup">
            <h4>${VEHICLE_EMOJI[vehicle.type] || '🚛'} ${vehicle.name}</h4>
            <p><strong>Type:</strong> ${vehicle.type}</p>
            <p><strong>Status:</strong> ${vehicle.status}</p>
            <p><strong>Location:</strong> ${vehicle.lat.toFixed(4)}°N, ${vehicle.lng.toFixed(4)}°E</p>
            ${vehicle.last_ping ? `<p><strong>Last Ping:</strong> ${new Date(vehicle.last_ping).toLocaleString()}</p>` : ''}
          </div>
        `);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([vehicle.lng, vehicle.lat])
        .setPopup(popup)
        .addTo(map);

      vehicleMarkersRef.current[vehicle.id] = marker;
    });
  }, [vehicles]);

  // Update incident markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(incidents.map(i => i.id));
    for (const [id, marker] of Object.entries(incidentMarkersRef.current)) {
      if (!currentIds.has(id)) {
        marker.remove();
        delete incidentMarkersRef.current[id];
      }
    }

    incidents.forEach(incident => {
      if (incidentMarkersRef.current[incident.id]) return;

      const el = document.createElement('div');
      el.className = 'marker-incident';
      el.innerHTML = `<span class="marker-incident-inner">${INCIDENT_EMOJI[incident.type] || '⚠️'}</span>`;

      el.addEventListener('click', () => {
        onIncidentClick?.(incident);
      });

      const popup = new maplibregl.Popup({ offset: 25, closeButton: false })
        .setHTML(`
          <div class="map-popup">
            <h4>${INCIDENT_EMOJI[incident.type] || '⚠️'} ${incident.type.replace('_', ' ').toUpperCase()}</h4>
            <p>${incident.description || 'No description provided.'}</p>
            <p><strong>Status:</strong> ${incident.status}</p>
            <p><strong>Location:</strong> ${incident.lat.toFixed(4)}°N, ${incident.lng.toFixed(4)}°E</p>
          </div>
        `);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([incident.lng, incident.lat])
        .setPopup(popup)
        .addTo(map);

      incidentMarkersRef.current[incident.id] = marker;
    });
  }, [incidents, onIncidentClick]);

  // Expose flyTo for external callers
  useEffect(() => {
    if (mapRef.current) {
      mapContainer.current.__flyTo = (lng, lat) => {
        mapRef.current.flyTo({ center: [lng, lat], zoom: 12, speed: 1.5 });
      };
    }
  });

  return <div ref={mapContainer} className="map-container" id="map-canvas" />;
}
