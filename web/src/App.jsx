/**
 * NavNER-AI Command Center — Main Application
 * Stage 1: Live vehicle tracking + incident reporting
 * Stage 2: AI Predictive Disruption Heatmap + Emergency Alerts
 */
import { useCallback, useRef, useState } from 'react';
import './index.css';
import { Header } from './components/Header';
import { MapCanvas } from './components/MapCanvas';
import { IncidentPanel } from './components/IncidentPanel';
import { HazardMapOverlay } from './components/HazardMapOverlay';
import { AlertBanner } from './components/AlertBanner';
import { useMapState } from './hooks/useMapState';
import { useWebSocket } from './hooks/useWebSocket';
import { useHazardMap } from './hooks/useHazardMap';

function App() {
  const { vehicles, setVehicles, incidents, setIncidents, loading, error } = useMapState();
  const [mapInstance, setMapInstance] = useState(null);
  const [riskUpdate, setRiskUpdate] = useState(null);

  // Fetch hazard data for the heatmap overlay
  const { hazardData, refetch: refetchHazard } = useHazardMap({ enabled: true });

  // Handle incoming WebSocket messages
  const handleWsMessage = useCallback((message) => {
    switch (message.event) {
      case 'telemetry_update': {
        const { vehicle_id, lat, lng, speed, timestamp } = message.data;
        setVehicles(prev =>
          prev.map(v =>
            v.id === vehicle_id
              ? { ...v, lat, lng, speed, last_ping: timestamp }
              : v
          )
        );
        break;
      }
      case 'new_incident': {
        const newIncident = message.data;
        setIncidents(prev => [newIncident, ...prev]);
        break;
      }
      case 'risk_update': {
        // Stage 2: Refresh hazard data when risk evaluation completes
        setRiskUpdate(message.data);
        refetchHazard();
        break;
      }
      default:
        console.log('[App] Unknown WS event:', message.event);
    }
  }, [setVehicles, setIncidents, refetchHazard]);

  const { isConnected } = useWebSocket(handleWsMessage);

  // Map ready callback — store reference for overlay
  const handleMapReady = useCallback((map) => {
    setMapInstance(map);
  }, []);

  // Fly to incident location on the map
  const handleFlyTo = useCallback((lng, lat) => {
    const container = document.getElementById('map-canvas');
    if (container?.__flyTo) {
      container.__flyTo(lng, lat);
    }
  }, []);

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Header
        vehicleCount={vehicles.length}
        incidentCount={incidents.length}
        isConnected={isConnected}
      />

      {/* Stage 2: Emergency Alert Banner */}
      <AlertBanner hazardData={hazardData} riskUpdate={riskUpdate} />

      <div className="app-body">
        <MapCanvas
          vehicles={vehicles}
          incidents={incidents}
          onIncidentClick={(incident) => handleFlyTo(incident.lng, incident.lat)}
          onMapReady={handleMapReady}
        />

        {/* Stage 2: Hazard Map Overlay Controls */}
        <HazardMapOverlay
          map={mapInstance}
          hazardData={hazardData}
          enabled={true}
        />

        <IncidentPanel
          incidents={incidents}
          onFlyTo={handleFlyTo}
        />
      </div>
    </div>
  );
}

export default App;
