/**
 * Side panel displaying real-time incident reports with type badges and animations.
 */
import { useState } from 'react';

const INCIDENT_EMOJI = {
  flood: '🌊',
  landslide: '⛰️',
  road_damage: '🚧',
  bridge_collapse: '🌉',
};

function formatLabel(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function IncidentPanel({ incidents, onFlyTo }) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        className="panel-toggle-float"
        onClick={() => setCollapsed(false)}
        id="panel-expand-btn"
      >
        ⚠️ Incidents ({incidents.length})
      </button>
    );
  }

  return (
    <aside className="incident-panel" id="incident-panel">
      <div className="panel-header">
        <div className="panel-title">
          ⚠️ Incident Feed
          <span className="panel-badge">{incidents.length}</span>
        </div>
        <button
          className="panel-toggle"
          onClick={() => setCollapsed(true)}
          id="panel-collapse-btn"
          title="Collapse panel"
        >
          ✕
        </button>
      </div>

      <div className="panel-list">
        {incidents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✅</div>
            <div className="empty-state-text">No active incidents</div>
          </div>
        ) : (
          incidents.map((incident, idx) => (
            <div
              key={incident.id}
              className={`incident-card ${incident.type} ${idx === 0 ? 'new-entry' : ''}`}
              onClick={() => onFlyTo?.(incident.lng, incident.lat)}
              id={`incident-card-${incident.id}`}
            >
              <div className="incident-card-header">
                <span className={`incident-type-badge ${incident.type}`}>
                  {INCIDENT_EMOJI[incident.type]} {formatLabel(incident.type)}
                </span>
                <span className={`incident-status-dot ${incident.status}`} title={formatLabel(incident.status)} />
              </div>

              <div className="incident-description">
                {incident.description || 'No description provided.'}
              </div>

              <div className="incident-meta">
                <span className="incident-coords">
                  {incident.lat?.toFixed(4)}°N, {incident.lng?.toFixed(4)}°E
                </span>
                <span>{incident.created_at ? timeAgo(incident.created_at) : '—'}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
