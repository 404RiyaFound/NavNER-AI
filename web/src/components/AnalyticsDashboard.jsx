/**
 * AnalyticsDashboard — Centralized Multi-District Analytics View
 *
 * Stage 4: Four Grafana-equivalent panels:
 * 1. Current Consignment State
 * 2. Delay Prediction Matrix
 * 3. Fleet Summary Board
 * 4. Hazard & Reroute Audits (24h)
 */
import { useAnalytics } from '../hooks/useAnalytics';

export function AnalyticsDashboard() {
  const {
    consignmentState,
    delayPrediction,
    fleetSummary,
    rerouteAudit,
    loading,
    error,
    refetch,
  } = useAnalytics({ enabled: true, refreshInterval: 30000 });

  if (loading && !consignmentState) {
    return (
      <div className="analytics-loading">
        <div className="loading-spinner"></div>
        <span>Loading analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="analytics-error">
        <span>⚠️ Analytics unavailable: {error}</span>
        <button className="analytics-retry-btn" onClick={refetch}>Retry</button>
      </div>
    );
  }

  return (
    <div className="analytics-dashboard" id="analytics-dashboard">
      {/* Dashboard Header */}
      <div className="analytics-header">
        <div className="analytics-header-title">
          <span className="analytics-icon">📊</span>
          <h2>Centralized Operations Intelligence</h2>
          <span className="analytics-subtitle">Multi-District Analytics • NER Supply Chain</span>
        </div>
        <div className="analytics-header-actions">
          {consignmentState && (
            <span className="analytics-timestamp">
              Updated: {new Date(consignmentState.generated_at).toLocaleTimeString()}
            </span>
          )}
          <button className="analytics-refresh-btn" onClick={refetch}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Top summary cards */}
      <div className="analytics-summary-row">
        <SummaryCard
          label="Active Consignments"
          value={consignmentState?.total_active_consignments || 0}
          icon="📦"
          accent="blue"
        />
        <SummaryCard
          label="Running Fleet"
          value={consignmentState?.total_running_fleet || 0}
          icon="🚛"
          accent="green"
        />
        <SummaryCard
          label="Critical Risk Trips"
          value={delayPrediction?.summary?.critical_risk || 0}
          icon="🔴"
          accent="red"
        />
        <SummaryCard
          label="Reroutes (24h)"
          value={rerouteAudit?.summary?.total_reroutes || 0}
          icon="🔀"
          accent="amber"
        />
      </div>

      {/* Panel grid */}
      <div className="analytics-panel-grid">
        {/* Panel 1: Consignment State */}
        <div className="analytics-panel" id="panel-consignment-state">
          <div className="analytics-panel-header">
            <h3>📦 Current Consignment State</h3>
            <span className="panel-badge">Real-time</span>
          </div>
          <div className="analytics-panel-body">
            {consignmentState?.origins?.length > 0 ? (
              <>
                <div className="consignment-table">
                  <div className="consignment-table-header">
                    <span>Origin</span>
                    <span>Consignments</span>
                    <span>Fleet</span>
                    <span>In Transit</span>
                    <span>Rerouted</span>
                  </div>
                  {consignmentState.origins.map((o, i) => (
                    <div className="consignment-table-row" key={i}>
                      <span className="consignment-origin">{o.origin}</span>
                      <span className="consignment-count">{o.total_consignments}</span>
                      <span className="consignment-fleet">{o.running_fleet}</span>
                      <span className="consignment-transit">{o.in_transit}</span>
                      <span className={`consignment-rerouted ${o.rerouted > 0 ? 'has-reroutes' : ''}`}>
                        {o.rerouted}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Commodity breakdown */}
                {consignmentState.commodity_breakdown && (
                  <div className="commodity-breakdown">
                    <span className="commodity-label">By Commodity:</span>
                    {Object.entries(consignmentState.commodity_breakdown).map(([type, count]) => (
                      <span key={type} className="commodity-chip">
                        {commodityIcon(type)} {type}: {count}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <span className="empty-state-icon">📦</span>
                <span className="empty-state-text">No active consignments</span>
              </div>
            )}
          </div>
        </div>

        {/* Panel 2: Delay Prediction Matrix */}
        <div className="analytics-panel" id="panel-delay-prediction">
          <div className="analytics-panel-header">
            <h3>⏱️ Delay Prediction Matrix</h3>
            <span className="panel-badge">ML-Powered</span>
          </div>
          <div className="analytics-panel-body">
            {delayPrediction?.predictions?.length > 0 ? (
              <div className="delay-table">
                <div className="delay-table-header">
                  <span>Vehicle</span>
                  <span>Route</span>
                  <span>Commodity</span>
                  <span>Delay Prob</span>
                  <span>Risk</span>
                </div>
                {delayPrediction.predictions.map((p, i) => (
                  <div className={`delay-table-row risk-${p.risk_classification.toLowerCase().replace('_', '-')}`} key={i}>
                    <span className="delay-vehicle">{p.vehicle_name}</span>
                    <span className="delay-route" title={`${p.origin} → ${p.destination}`}>
                      {p.origin} → {p.destination}
                    </span>
                    <span className="delay-commodity">{commodityIcon(p.commodity_type)} {p.commodity_type}</span>
                    <span className="delay-prob">
                      <span className="delay-prob-bar">
                        <span
                          className="delay-prob-fill"
                          style={{ width: `${Math.round(p.delay_probability * 100)}%` }}
                        ></span>
                      </span>
                      {Math.round(p.delay_probability * 100)}%
                    </span>
                    <span className={`delay-risk-badge ${p.risk_classification.toLowerCase().replace('_', '-')}`}>
                      {riskLabel(p.risk_classification)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-state-icon">✅</span>
                <span className="empty-state-text">No delay predictions</span>
              </div>
            )}
            {delayPrediction?.summary && (
              <div className="delay-summary">
                <span>Avg delay prob: <strong>{Math.round(delayPrediction.summary.avg_delay_probability * 100)}%</strong></span>
                <span>Critical: <strong className="text-red">{delayPrediction.summary.critical_risk}</strong></span>
                <span>High: <strong className="text-amber">{delayPrediction.summary.high_risk}</strong></span>
              </div>
            )}
          </div>
        </div>

        {/* Panel 3: Fleet Summary Board */}
        <div className="analytics-panel" id="panel-fleet-summary">
          <div className="analytics-panel-header">
            <h3>🚛 Fleet Summary Board</h3>
            <span className="panel-badge">Aggregated</span>
          </div>
          <div className="analytics-panel-body">
            {fleetSummary?.totals ? (
              <>
                {/* Fleet totals */}
                <div className="fleet-summary-totals">
                  <div className="fleet-total-card">
                    <span className="fleet-total-value">{fleetSummary.totals.total_vehicles}</span>
                    <span className="fleet-total-label">Total Fleet</span>
                  </div>
                  <div className="fleet-total-card active">
                    <span className="fleet-total-value">{fleetSummary.totals.active}</span>
                    <span className="fleet-total-label">Active</span>
                  </div>
                  <div className="fleet-total-card maintenance">
                    <span className="fleet-total-value">{fleetSummary.totals.maintenance}</span>
                    <span className="fleet-total-label">Maintenance</span>
                  </div>
                  <div className="fleet-total-card inactive">
                    <span className="fleet-total-value">{fleetSummary.totals.inactive}</span>
                    <span className="fleet-total-label">Inactive</span>
                  </div>
                </div>

                {/* Fleet by type */}
                {fleetSummary.fleet_by_type && (
                  <div className="fleet-type-breakdown">
                    {Object.entries(fleetSummary.fleet_by_type).map(([type, data]) => (
                      <div className="fleet-type-row" key={type}>
                        <span className="fleet-type-name">{vehicleIcon(type)} {type}</span>
                        <div className="fleet-type-bar">
                          <div
                            className="fleet-type-bar-fill active"
                            style={{ width: `${(data.active / Math.max(data.total, 1)) * 100}%` }}
                          ></div>
                          <div
                            className="fleet-type-bar-fill maintenance"
                            style={{ width: `${(data.maintenance / Math.max(data.total, 1)) * 100}%` }}
                          ></div>
                        </div>
                        <span className="fleet-type-count">{data.active}/{data.total}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Commodity trips */}
                {fleetSummary.commodity_trips && Object.keys(fleetSummary.commodity_trips).length > 0 && (
                  <div className="commodity-breakdown">
                    <span className="commodity-label">Active Trips by Cargo:</span>
                    {Object.entries(fleetSummary.commodity_trips).map(([type, count]) => (
                      <span key={type} className="commodity-chip">
                        {commodityIcon(type)} {type}: {count}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <span className="empty-state-icon">🚛</span>
                <span className="empty-state-text">No fleet data</span>
              </div>
            )}
          </div>
        </div>

        {/* Panel 4: Reroute Audit (24h) */}
        <div className="analytics-panel" id="panel-reroute-audit">
          <div className="analytics-panel-header">
            <h3>🔀 Reroute Audit (24h)</h3>
            {rerouteAudit?.summary && (
              <span className="panel-badge audit">
                {rerouteAudit.summary.total_reroutes} events
              </span>
            )}
          </div>
          <div className="analytics-panel-body">
            {rerouteAudit?.events?.length > 0 ? (
              <>
                <div className="audit-timeline">
                  {rerouteAudit.events.map((evt, i) => (
                    <div className="audit-event" key={i}>
                      <div className="audit-event-dot"></div>
                      <div className="audit-event-content">
                        <div className="audit-event-header">
                          <span className="audit-vehicle">{evt.vehicle_name}</span>
                          <span className="audit-reason-badge">{evt.trigger_reason}</span>
                          {evt.delay_minutes !== 0 && (
                            <span className={`audit-delay ${evt.delay_minutes > 0 ? 'positive' : 'negative'}`}>
                              {evt.delay_minutes > 0 ? '+' : ''}{evt.delay_minutes}m
                            </span>
                          )}
                        </div>
                        <div className="audit-event-route">
                          {evt.origin} → {evt.destination}
                          <span className="audit-commodity">{commodityIcon(evt.commodity_type)}</span>
                        </div>
                        {evt.created_at && (
                          <span className="audit-time">
                            {new Date(evt.created_at).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Audit summary */}
                {rerouteAudit.summary && (
                  <div className="audit-summary">
                    <span>Total delay: <strong>{rerouteAudit.summary.total_delay_minutes}m</strong></span>
                    <span>Avg delay: <strong>{rerouteAudit.summary.avg_delay_minutes}m</strong></span>
                    {rerouteAudit.summary.by_reason && Object.entries(rerouteAudit.summary.by_reason).map(([reason, count]) => (
                      <span key={reason} className="audit-reason-chip">{reason}: {count}</span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <span className="empty-state-icon">✅</span>
                <span className="empty-state-text">No reroutes in the last 24h</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, accent }) {
  return (
    <div className="analytics-summary-card">
      <div className={`summary-card-icon ${accent}`}>{icon}</div>
      <div className="summary-card-info">
        <span className="summary-card-value">{value}</span>
        <span className="summary-card-label">{label}</span>
      </div>
    </div>
  );
}

// ── Helper functions ──────────────────────────────────────────────────────────

function commodityIcon(type) {
  const icons = {
    MEDICINE: '💊', FOOD_GRAINS: '🌾', FUEL: '⛽', GENERAL: '📦',
  };
  return icons[type] || '📦';
}

function vehicleIcon(type) {
  const icons = { truck: '🚛', ambulance: '🚑', utility: '🔧' };
  return icons[type] || '🚛';
}

function riskLabel(classification) {
  const labels = {
    CRITICAL_RISK: '🔴 Critical',
    HIGH_RISK: '🟠 High',
    MODERATE_RISK: '🟡 Moderate',
    LOW_RISK: '🟢 Low',
  };
  return labels[classification] || classification;
}
