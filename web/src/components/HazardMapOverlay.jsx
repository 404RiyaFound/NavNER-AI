/**
 * HazardMapOverlay — Interactive AI Disruption Heatmap layer.
 *
 * Renders H3 hexagon polygons on MapLibre GL colored by risk level,
 * with a toggle switch, risk threshold slider, hover highlights, and
 * click popups showing detailed threat information.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';

const RISK_COLORS = {
  CRITICAL: '#E53935',
  HIGH: '#FB8C00',
  MODERATE: '#FDD835',
  LOW: '#43A047',
};

const RISK_OPACITY = {
  CRITICAL: 0.55,
  HIGH: 0.45,
  MODERATE: 0.35,
  LOW: 0.25,
};

const SOURCE_ID = 'hazard-hexagons';
const FILL_LAYER_ID = 'hazard-fill';
const LINE_LAYER_ID = 'hazard-line';
const HIGHLIGHT_LAYER_ID = 'hazard-highlight';

export function HazardMapOverlay({ map, hazardData, enabled }) {
  const [showLayer, setShowLayer] = useState(true);
  const [minRiskPct, setMinRiskPct] = useState(0);
  const popupRef = useRef(null);
  const layersAddedRef = useRef(false);

  // Filter features based on slider threshold
  const getFilteredGeoJSON = useCallback(() => {
    if (!hazardData?.features) {
      return { type: 'FeatureCollection', features: [] };
    }

    const threshold = minRiskPct / 100;
    const filtered = hazardData.features.filter(
      (f) => (f.properties?.composite_score ?? 0) >= threshold
    );

    return { type: 'FeatureCollection', features: filtered };
  }, [hazardData, minRiskPct]);

  // Add/update source and layers on the map
  useEffect(() => {
    if (!map || !enabled || !showLayer) {
      // Remove layers if they exist and we're disabling
      if (map && layersAddedRef.current) {
        try {
          if (map.getLayer(HIGHLIGHT_LAYER_ID)) map.removeLayer(HIGHLIGHT_LAYER_ID);
          if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
          if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID);
          if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
          layersAddedRef.current = false;
        } catch (e) { /* ignore */ }
      }
      return;
    }

    const geojson = getFilteredGeoJSON();

    // If source already exists, update its data
    const existingSource = map.getSource(SOURCE_ID);
    if (existingSource) {
      existingSource.setData(geojson);
      return;
    }

    // Add GeoJSON source
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: geojson,
    });

    // Fill layer — colored by risk_level
    map.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': [
          'match',
          ['get', 'risk_level'],
          'CRITICAL', RISK_COLORS.CRITICAL,
          'HIGH', RISK_COLORS.HIGH,
          'MODERATE', RISK_COLORS.MODERATE,
          'LOW', RISK_COLORS.LOW,
          '#888888',
        ],
        'fill-opacity': [
          'match',
          ['get', 'risk_level'],
          'CRITICAL', RISK_OPACITY.CRITICAL,
          'HIGH', RISK_OPACITY.HIGH,
          'MODERATE', RISK_OPACITY.MODERATE,
          'LOW', RISK_OPACITY.LOW,
          0.2,
        ],
      },
    });

    // Line layer — borders
    map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': [
          'match',
          ['get', 'risk_level'],
          'CRITICAL', RISK_COLORS.CRITICAL,
          'HIGH', RISK_COLORS.HIGH,
          'MODERATE', RISK_COLORS.MODERATE,
          'LOW', RISK_COLORS.LOW,
          '#888888',
        ],
        'line-width': 1.5,
        'line-opacity': 0.7,
      },
    });

    // Highlight layer — hover effect
    map.addLayer({
      id: HIGHLIGHT_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': '#ffffff',
        'fill-opacity': 0,
      },
    });

    layersAddedRef.current = true;

    // Hover effect
    const handleMouseMove = (e) => {
      if (!e.features?.length) return;
      map.getCanvas().style.cursor = 'pointer';
      map.setPaintProperty(HIGHLIGHT_LAYER_ID, 'fill-opacity', [
        'case',
        ['==', ['get', 'h3_index'], e.features[0].properties.h3_index],
        0.15,
        0,
      ]);
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      map.setPaintProperty(HIGHLIGHT_LAYER_ID, 'fill-opacity', 0);
    };

    // Click popup
    const handleClick = (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties;
      const coords = e.lngLat;

      // Close existing popup
      if (popupRef.current) popupRef.current.remove();

      const riskColor = RISK_COLORS[props.risk_level] || '#888';
      const blockagePercent = ((props.predicted_blockage_probability || 0) * 100).toFixed(1);
      const compositePercent = ((props.composite_score || 0) * 100).toFixed(1);

      const html = `
        <div class="hazard-popup">
          <div class="hazard-popup-header">
            <span class="hazard-risk-badge" style="background: ${riskColor}">
              ${props.risk_level}
            </span>
            <span class="hazard-popup-district">${props.district || 'Unknown'}</span>
          </div>
          <div class="hazard-popup-threat">
            ${props.primary_threat || 'No specific threat identified'}
          </div>
          <div class="hazard-popup-metrics">
            <div class="hazard-metric">
              <span class="hazard-metric-label">Landslide</span>
              <span class="hazard-metric-value">${((props.landslide_prob || 0) * 100).toFixed(1)}%</span>
            </div>
            <div class="hazard-metric">
              <span class="hazard-metric-label">Flood</span>
              <span class="hazard-metric-value">${((props.flood_prob || 0) * 100).toFixed(1)}%</span>
            </div>
            <div class="hazard-metric">
              <span class="hazard-metric-label">Composite</span>
              <span class="hazard-metric-value">${compositePercent}%</span>
            </div>
            <div class="hazard-metric">
              <span class="hazard-metric-label">Blockage</span>
              <span class="hazard-metric-value">${blockagePercent}%</span>
            </div>
          </div>
          <div class="hazard-popup-details">
            ${props.avg_slope_degrees ? `<span>Slope: ${Number(props.avg_slope_degrees).toFixed(1)}°</span>` : ''}
            ${props.elevation_meters ? `<span>Elev: ${Number(props.elevation_meters).toFixed(0)}m</span>` : ''}
            ${props.rainfall_1h_mm ? `<span>Rain/1h: ${Number(props.rainfall_1h_mm).toFixed(1)}mm</span>` : ''}
            ${props.rainfall_24h_mm ? `<span>Rain/24h: ${Number(props.rainfall_24h_mm).toFixed(1)}mm</span>` : ''}
          </div>
        </div>
      `;

      popupRef.current = new maplibregl.Popup({
        offset: 15,
        closeButton: true,
        maxWidth: '320px',
      })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);
    };

    map.on('mousemove', FILL_LAYER_ID, handleMouseMove);
    map.on('mouseleave', FILL_LAYER_ID, handleMouseLeave);
    map.on('click', FILL_LAYER_ID, handleClick);

    return () => {
      map.off('mousemove', FILL_LAYER_ID, handleMouseMove);
      map.off('mouseleave', FILL_LAYER_ID, handleMouseLeave);
      map.off('click', FILL_LAYER_ID, handleClick);

      if (popupRef.current) popupRef.current.remove();
    };
  }, [map, enabled, showLayer, getFilteredGeoJSON]);

  // Update data when hazardData changes
  useEffect(() => {
    if (!map || !enabled || !showLayer || !layersAddedRef.current) return;

    const source = map.getSource(SOURCE_ID);
    if (source) {
      source.setData(getFilteredGeoJSON());
    }
  }, [map, hazardData, minRiskPct, enabled, showLayer, getFilteredGeoJSON]);

  if (!enabled) return null;

  return (
    <div className="hazard-controls" id="hazard-controls">
      {/* Toggle switch */}
      <div className="hazard-toggle-row">
        <label className="hazard-toggle-label" htmlFor="hazard-toggle">
          <span className="hazard-toggle-icon">🛡️</span>
          AI Disruption Heatmap
        </label>
        <button
          className={`hazard-toggle-btn ${showLayer ? 'active' : ''}`}
          id="hazard-toggle"
          onClick={() => setShowLayer((v) => !v)}
          title={showLayer ? 'Hide heatmap' : 'Show heatmap'}
        >
          <span className="hazard-toggle-knob" />
        </button>
      </div>

      {/* Risk threshold slider */}
      {showLayer && (
        <div className="hazard-slider-row">
          <label className="hazard-slider-label" htmlFor="risk-threshold-slider">
            Min Risk: <strong>{minRiskPct}%</strong>
          </label>
          <input
            type="range"
            id="risk-threshold-slider"
            className="hazard-slider"
            min="0"
            max="100"
            value={minRiskPct}
            onChange={(e) => setMinRiskPct(Number(e.target.value))}
          />
          <div className="hazard-slider-marks">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
      )}

      {/* Legend */}
      {showLayer && (
        <div className="hazard-legend">
          {Object.entries(RISK_COLORS).map(([level, color]) => (
            <div key={level} className="hazard-legend-item">
              <span
                className="hazard-legend-swatch"
                style={{ background: color }}
              />
              <span className="hazard-legend-text">{level}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
