/**
 * NavNER-AI Command Center — Main Application
 */
import { useCallback, useRef } from 'react';
import './index.css';
import { Header } from './components/Header';
import { MapCanvas } from './components/MapCanvas';
import { IncidentPanel } from './components/IncidentPanel';
import { useMapState } from './hooks/useMapState';
import { useWebSocket } from './hooks/useWebSocket';

function App() {
  const { vehicles, setVehicles, incidents, setIncidents, loading, error } = useMapState();
  const mapContainerRef = useRef(null);

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
      default:
        console.log('[App] Unknown WS event:', message.event);
    }
  }, [setVehicles, setIncidents]);

  const { isConnected } = useWebSocket(handleWsMessage);

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
      <div className="app-body">
        <MapCanvas
          vehicles={vehicles}
          incidents={incidents}
          onIncidentClick={(incident) => handleFlyTo(incident.lng, incident.lat)}
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
