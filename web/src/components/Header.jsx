/**
 * Header component with branding, live stats, and WebSocket status.
 */
export function Header({ vehicleCount, incidentCount, isConnected }) {
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

        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className={`stat-dot ${isConnected ? 'green' : 'red'}`}></span>
          {isConnected ? 'Live' : 'Reconnecting...'}
        </div>
      </div>
    </header>
  );
}
