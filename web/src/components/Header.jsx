/**
 * Header component with branding, live stats, fleet status, and WebSocket status.
 */
export function Header({ vehicleCount, incidentCount, isConnected, fleetData }) {
  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-brand-icon">N</div>
        <div>
          <div className="header-title">NavNER Command Center</div>
          <div className="header-subtitle">NER Logistics Intelligence</div>
        </div>
      </div>

      <div className="header-stats">
        <div className="stat-item">
          <span className="stat-dot blue"></span>
          <span className="stat-count">{vehicleCount}</span>
          <span className="stat-label">Vehicles</span>
        </div>

        <div className="stat-item">
          <span className="stat-dot red"></span>
          <span className="stat-count">{incidentCount}</span>
          <span className="stat-label">Incidents</span>
        </div>

        {/* Stage 3: Fleet stats */}
        {fleetData && (
          <>
            <div className="stat-item">
              <span className="stat-dot green"></span>
              <span className="stat-count">{fleetData.total_active}</span>
              <span className="stat-label">Active Trips</span>
            </div>
            {fleetData.rerouted_count > 0 && (
              <div className="stat-item stat-item-alert">
                <span className="stat-dot amber"></span>
                <span className="stat-count">{fleetData.rerouted_count}</span>
                <span className="stat-label">Rerouted</span>
              </div>
            )}
          </>
        )}

        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className={`stat-dot ${isConnected ? 'green' : 'red'}`}></span>
          {isConnected ? 'Live' : 'Reconnecting...'}
        </div>
      </div>
    </header>
  );
}
