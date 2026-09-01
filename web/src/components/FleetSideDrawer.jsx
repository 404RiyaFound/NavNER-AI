/**
 * FleetSideDrawer — Fleet Matrix Side Drawer
 *
 * Stage 3: Lists active supply vehicles categorized by priority with
 * live status tags and reroute approval controls.
 */
import { useState, useMemo } from 'react';

export function FleetSideDrawer({ fleetData, loading, selectedTripId, onSelectTrip, onTriggerReroute }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [filterPriority, setFilterPriority] = useState('ALL');

  // Priority badge config
  const priorityConfig = {
    EMERGENCY: { emoji: '🔴', label: 'Emergency', class: 'priority-emergency', order: 0 },
    HIGH_PRIORITY: { emoji: '🟠', label: 'High', class: 'priority-high', order: 1 },
    STANDARD: { emoji: '🔵', label: 'Standard', class: 'priority-standard', order: 2 },
  };

  // Commodity icons
  const commodityIcons = {
    MEDICINE: '💊',
    FOOD_GRAINS: '🌾',
    FUEL: '⛽',
    GENERAL: '📦',
  };

  // Sort trips by priority (emergency first) then by status (rerouted first)
  const sortedTrips = useMemo(() => {
    if (!fleetData?.active_trips) return [];
    let trips = [...fleetData.active_trips];

    if (filterPriority !== 'ALL') {
      trips = trips.filter(t => t.priority_level === filterPriority);
    }

    return trips.sort((a, b) => {
      const prioA = priorityConfig[a.priority_level]?.order ?? 3;
      const prioB = priorityConfig[b.priority_level]?.order ?? 3;
      if (prioA !== prioB) return prioA - prioB;
      // Rerouted trips shown first
      if (a.status === 'REROUTED' && b.status !== 'REROUTED') return -1;
      if (a.status !== 'REROUTED' && b.status === 'REROUTED') return 1;
      return 0;
    });
  }, [fleetData, filterPriority]);

  // Status label + class
  const getStatusInfo = (trip) => {
    if (trip.status === 'REROUTED') {
      const delay = trip.delay_minutes;
      return {
        label: delay ? `Rerouted (+${delay}m)` : 'Rerouted',
        class: 'fleet-status-rerouted',
      };
    }
    if (trip.status === 'IN_TRANSIT') return { label: 'On Route', class: 'fleet-status-active' };
    if (trip.status === 'PENDING') return { label: 'Pending', class: 'fleet-status-pending' };
    return { label: trip.status, class: 'fleet-status-default' };
  };

  if (isCollapsed) {
    return (
      <button
        className="fleet-drawer-toggle-float"
        onClick={() => setIsCollapsed(false)}
        id="fleet-drawer-toggle"
      >
        🚛 Fleet ({fleetData?.total_active || 0})
        {fleetData?.rerouted_count > 0 && (
          <span className="fleet-drawer-rerouted-badge">{fleetData.rerouted_count}</span>
        )}
      </button>
    );
  }

  return (
    <div className="fleet-drawer" id="fleet-side-drawer">
      {/* Header */}
      <div className="fleet-drawer-header">
        <div className="fleet-drawer-title">
          <span>🚛 Fleet Monitor</span>
          {fleetData && (
            <span className="fleet-drawer-count-badge">{fleetData.total_active}</span>
          )}
        </div>
        <button
          className="panel-toggle"
          onClick={() => setIsCollapsed(true)}
          title="Collapse"
        >
          ✕
        </button>
      </div>

      {/* Stats Bar */}
      {fleetData && (
        <div className="fleet-drawer-stats">
          <div className="fleet-stat-chip">
            <span className="fleet-stat-dot active"></span>
            <span>{fleetData.total_active} Active</span>
          </div>
          {fleetData.rerouted_count > 0 && (
            <div className="fleet-stat-chip rerouted">
              <span className="fleet-stat-dot rerouted"></span>
              <span>{fleetData.rerouted_count} Rerouted</span>
            </div>
          )}
          {fleetData.emergency_count > 0 && (
            <div className="fleet-stat-chip emergency">
              <span className="fleet-stat-dot emergency"></span>
              <span>{fleetData.emergency_count} Emergency</span>
            </div>
          )}
        </div>
      )}

      {/* Priority Filter */}
      <div className="fleet-drawer-filters">
        {['ALL', 'EMERGENCY', 'HIGH_PRIORITY', 'STANDARD'].map((f) => (
          <button
            key={f}
            className={`fleet-filter-btn ${filterPriority === f ? 'active' : ''}`}
            onClick={() => setFilterPriority(f)}
          >
            {f === 'ALL' ? 'All' : priorityConfig[f]?.label || f}
          </button>
        ))}
      </div>

      {/* Trip List */}
      <div className="fleet-drawer-list">
        {loading && !fleetData && (
          <div className="empty-state">
            <div className="loading-spinner" style={{ width: 24, height: 24 }}></div>
            <span className="empty-state-text">Loading fleet...</span>
          </div>
        )}

        {!loading && sortedTrips.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon">🚛</span>
            <span className="empty-state-text">No active trips</span>
          </div>
        )}

        {sortedTrips.map((trip) => {
          const prio = priorityConfig[trip.priority_level] || priorityConfig.STANDARD;
          const statusInfo = getStatusInfo(trip);
          const isSelected = trip.trip_id === selectedTripId;
          const commodity = commodityIcons[trip.commodity_type] || '📦';

          return (
            <div
              key={trip.trip_id}
              className={`fleet-trip-card ${isSelected ? 'selected' : ''} ${trip.status === 'REROUTED' ? 'rerouted' : ''}`}
              onClick={() => onSelectTrip?.(trip.trip_id)}
              id={`fleet-trip-${trip.trip_id.slice(0, 8)}`}
            >
              {/* Trip card accent bar */}
              <div className={`fleet-trip-accent ${prio.class}`}></div>

              <div className="fleet-trip-card-content">
                {/* Top row: vehicle + priority */}
                <div className="fleet-trip-top-row">
                  <span className="fleet-trip-vehicle">{trip.vehicle_name}</span>
                  <span className={`fleet-trip-priority ${prio.class}`}>
                    {prio.emoji}
                  </span>
                </div>

                {/* Route */}
                <div className="fleet-trip-route">
                  {commodity} {trip.origin_name} → {trip.dest_name}
                </div>

                {/* Bottom row: status + ETA */}
                <div className="fleet-trip-bottom-row">
                  <span className={`fleet-trip-status ${statusInfo.class}`}>
                    {statusInfo.label}
                  </span>
                  {trip.estimated_arrival && (
                    <span className="fleet-trip-eta">
                      ETA: {new Date(trip.estimated_arrival).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>

                {/* Reroute action (inline for rerouted trips) */}
                {trip.status === 'REROUTED' && (
                  <div className="fleet-trip-action-row">
                    <button
                      className="fleet-trip-action-btn accept"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTriggerReroute?.(trip.trip_id);
                      }}
                    >
                      ✓ Accept
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
