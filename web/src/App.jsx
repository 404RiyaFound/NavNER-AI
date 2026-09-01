/**
 * NavNER-AI Command Center — Main Application
 * Stage 1: Live vehicle tracking + incident reporting
 * Stage 2: AI Predictive Disruption Heatmap + Emergency Alerts
 * Stage 3: Dynamic Rerouting Engine + Fleet Optimization
 * Stage 4: Centralized Analytics Dashboard + Alert Dispatch
 */
import { useCallback, useState } from 'react';
import './index.css';
import { Header } from './components/Header';
import { MapCanvas } from './components/MapCanvas';
import { IncidentPanel } from './components/IncidentPanel';
import { HazardMapOverlay } from './components/HazardMapOverlay';
import { AlertBanner } from './components/AlertBanner';
import { FleetRouteViewer } from './components/FleetRouteViewer';
import { FleetSideDrawer } from './components/FleetSideDrawer';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { useMapState } from './hooks/useMapState';
import { useWebSocket } from './hooks/useWebSocket';
import { useHazardMap } from './hooks/useHazardMap';
import { useFleetStatus } from './hooks/useFleetStatus';

function App() {
  const { vehicles, setVehicles, incidents, setIncidents, loading, error } = useMapState();
  const [mapInstance, setMapInstance] = useState(null);
  const [riskUpdate, setRiskUpdate] = useState(null);
  const [selectedTripId, setSelectedTripId] = useState(null);
  const [activeView, setActiveView] = useState('map'); // 'map' | 'analytics'

  // Fetch hazard data for the heatmap overlay
  const { hazardData, refetch: refetchHazard } = useHazardMap({ enabled: true });

  // Stage 3: Fleet status management
  const {
    fleetData,
    loading: fleetLoading,
    refetch: refetchFleet,
    handleRerouteAlert,
    triggerReroute,
  } = useFleetStatus({ enabled: true });

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
        setRiskUpdate(message.data);
        refetchHazard();
        break;
      }
      case 'reroute_alert': {
        handleRerouteAlert(message.data);
        refetchFleet();
        break;
      }
      case 'fleet_update': {
        refetchFleet();
        break;
      }
      default:
        console.log('[App] Unknown WS event:', message.event);
    }
  }, [setVehicles, setIncidents, refetchHazard, handleRerouteAlert, refetchFleet]);

  const { isConnected } = useWebSocket(handleWsMessage);

  const handleMapReady = useCallback((map) => {
    setMapInstance(map);
  }, []);

  const handleFlyTo = useCallback((lng, lat) => {
    const container = document.getElementById('map-canvas');
    if (container?.__flyTo) {
      container.__flyTo(lng, lat);
    }
  }, []);

  // Stage 3: Route actions
  const handleAcceptRoute = useCallback(async (tripId) => {
    try {
      await triggerReroute(tripId, true, 0.60);
    } catch (err) {
      console.error('[App] Accept route error:', err);
    }
  }, [triggerReroute]);

  const handleRevertRoute = useCallback(async (tripId) => {
    try {
      await triggerReroute(tripId, false, 1.0);
    } catch (err) {
      console.error('[App] Revert route error:', err);
    }
  }, [triggerReroute]);

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
        fleetData={fleetData}
        activeView={activeView}
        onViewChange={setActiveView}
      />

      {/* Stage 2: Emergency Alert Banner */}
      <AlertBanner hazardData={hazardData} riskUpdate={riskUpdate} />

      {/* Stage 4: Tab-based view switching */}
      {activeView === 'map' ? (
        <div className="app-body">
          {/* Stage 3: Fleet Side Drawer (left side) */}
          <FleetSideDrawer
            fleetData={fleetData}
            loading={fleetLoading}
            selectedTripId={selectedTripId}
            onSelectTrip={setSelectedTripId}
            onTriggerReroute={handleAcceptRoute}
          />

          <MapCanvas
            vehicles={vehicles}
            incidents={incidents}
            onIncidentClick={(incident) => handleFlyTo(incident.lng, incident.lat)}
            onMapReady={handleMapReady}
          />

          {/* Stage 3: Route overlay on map */}
          <FleetRouteViewer
            map={mapInstance}
            fleetData={fleetData}
            selectedTripId={selectedTripId}
            onSelectTrip={setSelectedTripId}
            onAcceptRoute={handleAcceptRoute}
            onRevertRoute={handleRevertRoute}
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
      ) : (
        <div className="app-body analytics-view">
          <AnalyticsDashboard />
        </div>
      )}
    </div>
  );
}

export default App;
