/**
 * AnalyticsDashboard — Centralized Operations Intelligence (/analytics)
 *
 * Professional dark theme with orange accent. No internal nav rail — navigation
 * is handled by the global Header.jsx tab switcher.
 *
 * Layout:
 *  ┌──────────────────────────────────────────────────────────────────────────┐
 *  │  Topbar: title · search · updated-at · refresh · Generate Report        │
 *  ├───────────┬──────────────────────────────────────────┬───────────────────┤
 *  │  KPI Stack│  AI Delay Prediction Matrix               │  Reroute Audit    │
 *  │           │                                           │  Timeline (24h)   │
 *  │  Fleet    ├──────────────────────────────────────────┤                   │
 *  │  Summary  │  District-Wise Delay Spikes               │                   │
 *  ├───────────┴──────────────────────────────────────────┴───────────────────┤
 *  │  Origin Consignment Table (full-width)                                   │
 *  ├──────────────────────────────────────────────────────────────────────────┤
 *  │  Alert Log Strip                                                         │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 * Data: /api/v1/dashboard/* endpoints via useAnalytics (30s polling).
 * Spike chart is bucketed from the real reroute-audit events, not synthesised —
 * see buildSpikeSeriesFromAudit.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAnalytics } from '../hooks/useAnalytics';

export function AnalyticsDashboard() {
  const {
    consignmentState,
    delayPrediction,
    fleetSummary,
    rerouteAudit,
    alertLog,
    loading,
    error,
    refetch,
  } = useAnalytics({ enabled: true, refreshInterval: 30000 });

  const [query, setQuery] = useState('');

  // Recomputed whenever the audit refreshes (30s poll), so the chart tracks
  // real reroute activity instead of being fixed at mount time.
  const spike = useMemo(
    () => buildSpikeSeriesFromAudit(rerouteAudit?.events, rerouteAudit?.lookback_hours),
    [rerouteAudit],
  );

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading && !consignmentState) {
    return (
      <div className="ops-dash ops-dash--center" id="analytics-dashboard">
        <div className="ops-spinner" />
        <span className="ops-state-text">Loading operations intelligence…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ops-dash ops-dash--center" id="analytics-dashboard">
        <Icon n="alert" className="ops-state-icon" />
        <span className="ops-state-text">Analytics unavailable — {error}</span>
        <button className="ops-report-btn" onClick={refetch}>
          <Icon n="refresh" /> Retry
        </button>
      </div>
    );
  }

  // ── Derived / filtered data ───────────────────────────────────────────────
  const q = query.trim().toLowerCase();

  const predictions = (delayPrediction?.predictions || []).filter(
    (p) =>
      !q ||
      `${p.vehicle_name} ${p.origin} ${p.destination} ${p.commodity_type}`
        .toLowerCase()
        .includes(q),
  );

  const events = (rerouteAudit?.events || []).filter(
    (e) =>
      !q ||
      `${e.vehicle_name} ${e.origin} ${e.destination} ${e.trigger_reason}`
        .toLowerCase()
        .includes(q),
  );

  const alerts = (alertLog?.alerts || []).filter(
    (a) =>
      !q ||
      `${a.vehicle_name || ''} ${a.message || ''} ${a.tier || ''}`
        .toLowerCase()
        .includes(q),
  );

  const origins = (consignmentState?.origins || []).filter(
    (o) => !q || o.origin.toLowerCase().includes(q),
  );

  const updatedAt = consignmentState?.generated_at
    ? new Date(consignmentState.generated_at).toLocaleTimeString()
    : null;

  // ── Export helper ─────────────────────────────────────────────────────────
  const handleGenerateReport = () => {
    window.print();
  };

  return (
    <div className="ops-dash" id="analytics-dashboard">
      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <header className="ops-topbar">
        <div className="ops-topbar-title">
          <h1>Operations Analytics</h1>
          <p>Multi-district intelligence · NER supply chain</p>
        </div>

        <label className="ops-search" htmlFor="analytics-search">
          <Icon n="search" />
          <input
            id="analytics-search"
            type="text"
            placeholder="Search vehicles, routes, districts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="ops-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <Icon n="x" />
            </button>
          )}
        </label>

        <div className="ops-topbar-actions">
          {updatedAt && (
            <span className="ops-updated">
              <Icon n="clock" />
              {updatedAt}
            </span>
          )}
          <button
            className="ops-icon-btn"
            onClick={refetch}
            title="Refresh"
            aria-label="Refresh analytics"
          >
            <Icon n="refresh" />
          </button>
          <button className="ops-report-btn" onClick={handleGenerateReport} id="btn-generate-report">
            <Icon n="download" /> Generate Report
          </button>
        </div>
      </header>

      {/* ── Scrollable body ──────────────────────────────────────────────── */}
      <div className="ops-body">
        {/* ── Row 1: KPI + Matrix + Reroute Audit ─────────────────────── */}
        <div className="ops-grid ops-grid--main">
          {/* Column 1 — KPI stack + Fleet summary */}
          <div className="ops-col ops-col--kpi">
            <div className="ops-kpi-stack">
              <KpiCard
                primary
                icon="package"
                value={consignmentState?.total_active_consignments ?? 0}
                label="Active Consignments"
                sub="On the way"
                id="kpi-consignments"
              />
              <KpiCard
                icon="truck"
                value={consignmentState?.total_running_fleet ?? 0}
                label="Running Fleet"
                sub="Vehicles in motion"
                id="kpi-fleet"
              />
              <KpiCard
                icon="alert-triangle"
                value={delayPrediction?.summary?.critical_risk ?? 0}
                label="Critical Risk Trips"
                sub="High delay probability"
                accent="red"
                id="kpi-critical"
              />
              <KpiCard
                icon="route"
                value={rerouteAudit?.summary?.total_reroutes ?? 0}
                label="Reroutes · 24h"
                sub={`${rerouteAudit?.summary?.total_delay_minutes ?? 0}m added`}
                accent="amber"
                id="kpi-reroutes"
              />
            </div>

            {/* Fleet Summary Panel */}
            <FleetSummaryPanel fleetSummary={fleetSummary} />
          </div>

          {/* Column 2 — Delay matrix + Spike chart */}
          <div className="ops-col ops-col--center">
            <section className="ops-panel" id="panel-delay-prediction">
              <div className="ops-panel-head">
                <div className="ops-panel-head-left">
                  <span className="ops-panel-accent" />
                  <h2>AI Delay Prediction Matrix</h2>
                </div>
                <div className="ops-panel-head-right">
                  <span className="ops-tag ops-tag--ml">
                    <Icon n="cpu" />
                    ML-Powered
                  </span>
                  {delayPrediction?.summary && (
                    <span className="ops-tag ops-tag--neutral">
                      {delayPrediction.summary.total_trips} trips
                    </span>
                  )}
                </div>
              </div>

              {predictions.length > 0 ? (
                <div className="matrix" role="table" aria-label="Delay prediction matrix">
                  <div className="matrix-row matrix-row--head" role="row">
                    <span role="columnheader">Vehicle</span>
                    <span role="columnheader">Route</span>
                    <span role="columnheader">Commodity</span>
                    <span role="columnheader">Status</span>
                    <span className="matrix-prob-col" role="columnheader">Delay Prob.</span>
                  </div>
                  {predictions.map((p, i) => {
                    const pct = Math.round((p.delay_probability ?? 0) * 100);
                    const isCritical = /CRITICAL/.test(p.risk_classification || '');
                    const isHigh = /HIGH/.test(p.risk_classification || '');
                    const riskClass = isCritical ? 'is-critical' : isHigh ? 'is-high' : 'is-moderate';
                    return (
                      <div
                        className={`matrix-row ${isCritical ? 'matrix-row--critical' : ''}`}
                        key={p.trip_id || i}
                        role="row"
                        style={{ animationDelay: `${i * 40}ms` }}
                      >
                        <span className="m-vehicle">{p.vehicle_name}</span>
                        <span className="m-route" title={`${p.origin} → ${p.destination}`}>
                          {p.origin} <span className="m-arrow">→</span> {p.destination}
                        </span>
                        <span className="m-commodity">
                          <Icon n={commodityIcon(p.commodity_type)} />
                          {labelCase(p.commodity_type)}
                        </span>
                        <span className="m-status">
                          <StatusPill status={p.status} />
                        </span>
                        <span className="m-prob">
                          <span className="prob-bar">
                            <span
                              className={`prob-fill ${riskClass}`}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className={`prob-num prob-num--${riskClass}`}>{pct}%</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text={q ? 'No matches for this search' : 'No delay predictions'} />
              )}

              {/* Risk summary bar */}
              {delayPrediction?.summary && predictions.length > 0 && (
                <div className="matrix-summary">
                  <SummaryPill
                    color="var(--red)"
                    label="Critical"
                    value={delayPrediction.summary.critical_risk}
                  />
                  <SummaryPill
                    color="var(--amber)"
                    label="High Risk"
                    value={delayPrediction.summary.high_risk}
                  />
                  <SummaryPill
                    color="var(--text-muted)"
                    label="Avg Prob."
                    value={`${Math.round((delayPrediction.summary.avg_delay_probability || 0) * 100)}%`}
                  />
                </div>
              )}
            </section>

            <section className="ops-panel" id="panel-district-spikes">
              <div className="ops-panel-head">
                <div className="ops-panel-head-left">
                  <span className="ops-panel-accent" />
                  <h2>District-Wise Delay Spikes</h2>
                </div>
                <div className="ops-panel-head-right">
                  <span className="ops-tag ops-tag--neutral">Last 24h</span>
                </div>
              </div>
              {spike.empty ? (
                <div className="ops-empty ops-empty--chart">
                  No reroute delay recorded in this window — the delay history
                  fills in as trips reroute.
                </div>
              ) : (
                <SpikeAreaChart labels={spike.labels} series={spike.series} />
              )}
            </section>
          </div>

          {/* Column 3 — Reroute audit timeline */}
          <div className="ops-col ops-col--right">
            <section className="ops-panel ops-panel--timeline" id="panel-reroute-audit">
              <div className="ops-panel-head">
                <div className="ops-panel-head-left">
                  <span className="ops-panel-accent ops-panel-accent--amber" />
                  <h2>Reroute Audit</h2>
                </div>
                <span className="ops-tag ops-tag--neutral">
                  {rerouteAudit?.summary?.total_reroutes ?? events.length} events
                </span>
              </div>

              {events.length > 0 ? (
                <ol className="timeline" aria-label="Reroute events timeline">
                  {events.map((evt, i) => (
                    <li
                      className="timeline-item"
                      key={evt.log_id || i}
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <span className="timeline-time">{shortTime(evt.created_at)}</span>
                      <span className="timeline-marker" />
                      <div className="timeline-body">
                        <p className="timeline-title">{evt.vehicle_name} Rerouted</p>
                        <p className="timeline-sub">
                          {evt.trigger_reason}
                          {evt.delay_minutes ? (
                            <>
                              {' '}·{' '}
                              <span
                                className={
                                  evt.delay_minutes > 0
                                    ? 'timeline-delay'
                                    : 'timeline-delay is-gain'
                                }
                              >
                                {evt.delay_minutes > 0 ? '+' : ''}
                                {evt.delay_minutes}m
                              </span>
                            </>
                          ) : null}
                        </p>
                        <p className="timeline-route">
                          <Icon n={commodityIcon(evt.commodity_type)} className="timeline-cargo" />
                          {evt.origin} <span className="m-arrow">→</span> {evt.destination}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState text={q ? 'No matches' : 'No reroutes in the last 24h'} icon="route" />
              )}

              {rerouteAudit?.summary && events.length > 0 && (
                <div className="timeline-foot">
                  <span>
                    Total delay <strong>{rerouteAudit.summary.total_delay_minutes}m</strong>
                  </span>
                  <span>
                    Avg <strong>{rerouteAudit.summary.avg_delay_minutes}m</strong>
                  </span>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* ── Row 2: Origin Table + Commodity Chart ───────────────────────── */}
        <div className="ops-grid ops-grid--bottom">
          {/* Origin consignment table */}
          <section className="ops-panel ops-panel--wide" id="panel-origin-table">
            <div className="ops-panel-head">
              <div className="ops-panel-head-left">
                <span className="ops-panel-accent ops-panel-accent--blue" />
                <h2>Origin Consignment State</h2>
              </div>
              <span className="ops-tag ops-tag--neutral">{origins.length} origins</span>
            </div>
            <OriginTable origins={origins} />
          </section>

          {/* Commodity breakdown */}
          <section className="ops-panel" id="panel-commodity-breakdown">
            <div className="ops-panel-head">
              <div className="ops-panel-head-left">
                <span className="ops-panel-accent ops-panel-accent--green" />
                <h2>Commodity Breakdown</h2>
              </div>
            </div>
            <CommodityBreakdown
              breakdown={consignmentState?.commodity_breakdown}
              fleetSummary={fleetSummary}
            />
          </section>
        </div>

        {/* ── Row 3: Alert Log Strip ───────────────────────────────────────── */}
        {alerts.length > 0 && (
          <section className="ops-panel ops-panel--alert-log" id="panel-alert-log">
            <div className="ops-panel-head">
              <div className="ops-panel-head-left">
                <span className="ops-panel-accent ops-panel-accent--red" />
                <h2>Recent Alerts</h2>
              </div>
              <div className="ops-panel-head-right">
                <span className="ops-tag ops-tag--neutral">{alertLog?.total_returned ?? 0} alerts</span>
                {alertLog?.buffered_informational > 0 && (
                  <span className="ops-tag ops-tag--neutral">
                    +{alertLog.buffered_informational} buffered
                  </span>
                )}
              </div>
            </div>
            <AlertLogStrip alerts={alerts} />
          </section>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ primary, icon, value, label, sub, accent, id }) {
  const accentMap = {
    red: 'kpi-card--red',
    amber: 'kpi-card--amber',
    green: 'kpi-card--green',
  };
  const cls = primary
    ? 'kpi-card kpi-card--primary'
    : `kpi-card ${accent ? accentMap[accent] || '' : ''}`;

  return (
    <div className={cls} id={id}>
      <div className="kpi-header">
        <span className="kpi-icon">
          <Icon n={icon} />
        </span>
      </div>
      <AnimatedNumber value={value} className="kpi-value" />
      <span className="kpi-label">{label}</span>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

/** Counts up to the target value on mount / value change. */
function AnimatedNumber({ value, className }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const start = 0;
    const end = Number(value) || 0;
    const duration = 600;
    const startTime = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + eased * (end - start)));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <span className={className}>{display}</span>;
}

function StatusPill({ status }) {
  const map = {
    IN_TRANSIT: { label: 'In Transit', cls: 'status--transit' },
    REROUTED: { label: 'Rerouted', cls: 'status--rerouted' },
    PENDING: { label: 'Pending', cls: 'status--pending' },
    COMPLETED: { label: 'Completed', cls: 'status--completed' },
  };
  const { label, cls } = map[status] || { label: status, cls: '' };
  return <span className={`status-pill ${cls}`}>{label}</span>;
}

function SummaryPill({ color, label, value }) {
  return (
    <div className="summary-pill">
      <span className="summary-pill-dot" style={{ background: color }} />
      <span className="summary-pill-label">{label}</span>
      <span className="summary-pill-value">{value}</span>
    </div>
  );
}

function FleetSummaryPanel({ fleetSummary }) {
  if (!fleetSummary) {
    return (
      <section className="ops-panel" id="panel-fleet-summary">
        <div className="ops-panel-head">
          <div className="ops-panel-head-left">
            <span className="ops-panel-accent ops-panel-accent--green" />
            <h2>Fleet Summary</h2>
          </div>
        </div>
        <EmptyState text="Loading fleet data…" icon="truck" />
      </section>
    );
  }

  const { totals, fleet_by_type, commodity_trips } = fleetSummary;

  return (
    <section className="ops-panel" id="panel-fleet-summary">
      <div className="ops-panel-head">
        <div className="ops-panel-head-left">
          <span className="ops-panel-accent ops-panel-accent--green" />
          <h2>Fleet Summary</h2>
        </div>
        <span className="ops-tag ops-tag--neutral">{totals?.total_vehicles ?? 0} vehicles</span>
      </div>

      <div className="fleet-totals">
        <FleetStat label="Active" value={totals?.active ?? 0} color="var(--green)" />
        <FleetStat label="Maintenance" value={totals?.maintenance ?? 0} color="var(--amber)" />
        <FleetStat label="Inactive" value={totals?.inactive ?? 0} color="var(--text-muted)" />
      </div>

      {fleet_by_type && Object.keys(fleet_by_type).length > 0 && (
        <div className="fleet-type-list">
          {Object.entries(fleet_by_type).map(([type, stats]) => (
            <div className="fleet-type-row" key={type}>
              <span className="fleet-type-name">
                <Icon n={vehicleTypeIcon(type)} />
                {labelCase(type)}
              </span>
              <div className="fleet-type-bar-wrap">
                <div
                  className="fleet-type-bar-fill"
                  style={{
                    width: `${totals?.total_vehicles > 0 ? (stats.active / totals.total_vehicles) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="fleet-type-count">{stats.active}/{stats.total}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FleetStat({ label, value, color }) {
  return (
    <div className="fleet-stat">
      <span className="fleet-stat-dot" style={{ background: color }} />
      <span className="fleet-stat-val">{value}</span>
      <span className="fleet-stat-label">{label}</span>
    </div>
  );
}

function OriginTable({ origins }) {
  if (!origins || origins.length === 0) {
    return <EmptyState text="No origin data available" icon="map" />;
  }

  return (
    <div className="origin-table" role="table" aria-label="Origin consignment state">
      <div className="origin-row origin-row--head" role="row">
        <span role="columnheader">Origin</span>
        <span role="columnheader">Consignments</span>
        <span role="columnheader">Fleet</span>
        <span role="columnheader">In Transit</span>
        <span role="columnheader">Rerouted</span>
        <span role="columnheader">Pending</span>
        <span role="columnheader">Status</span>
      </div>
      {origins.map((o, i) => {
        const total = o.total_consignments || 1;
        const inTransitPct = Math.round(((o.in_transit || 0) / total) * 100);
        return (
          <div className="origin-row" key={o.origin} role="row" style={{ animationDelay: `${i * 30}ms` }}>
            <span className="origin-name">{o.origin}</span>
            <span className="origin-num">{o.total_consignments}</span>
            <span className="origin-num">{o.running_fleet}</span>
            <span className="origin-num origin-num--transit">{o.in_transit || 0}</span>
            <span className="origin-num origin-num--rerouted">{o.rerouted || 0}</span>
            <span className="origin-num origin-num--pending">{o.pending || 0}</span>
            <span className="origin-bar-cell">
              <div className="origin-bar">
                <div className="origin-bar-fill" style={{ width: `${inTransitPct}%` }} />
              </div>
              <span className="origin-bar-pct">{inTransitPct}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CommodityBreakdown({ breakdown, fleetSummary }) {
  const commodityTrips = fleetSummary?.commodity_trips || breakdown || {};
  const entries = Object.entries(commodityTrips);
  const maxVal = Math.max(1, ...entries.map(([, v]) => v));

  if (entries.length === 0) {
    return <EmptyState text="No commodity data" icon="package" />;
  }

  const colorMap = {
    MEDICINE: '#a855f7',
    PHARMA: '#a855f7',
    FOOD_GRAINS: '#22c55e',
    FUEL: '#f59e0b',
    GENERAL: '#3b82f6',
  };

  return (
    <div className="commodity-list">
      {entries.map(([type, count]) => {
        const pct = Math.round((count / maxVal) * 100);
        const color = colorMap[type] || '#6b7280';
        return (
          <div className="commodity-row" key={type}>
            <span className="commodity-icon">
              <Icon n={commodityIcon(type)} />
            </span>
            <span className="commodity-name">{labelCase(type)}</span>
            <div className="commodity-bar-wrap">
              <div className="commodity-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="commodity-count">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function AlertLogStrip({ alerts }) {
  const tierColor = {
    CRITICAL: 'var(--red)',
    HIGH: 'var(--orange)',
    MEDIUM: 'var(--amber)',
    LOW: 'var(--text-muted)',
    INFORMATIONAL: 'var(--blue)',
  };

  return (
    <div className="alert-log-list">
      {alerts.slice(0, 20).map((a, i) => (
        <div className="alert-log-item" key={a.alert_id || i} style={{ animationDelay: `${i * 25}ms` }}>
          <span
            className="alert-log-tier"
            style={{ color: tierColor[a.tier] || 'var(--text-muted)', borderColor: tierColor[a.tier] }}
          >
            {a.tier || 'INFO'}
          </span>
          <span className="alert-log-vehicle">{a.vehicle_name || '—'}</span>
          <span className="alert-log-msg">{a.message || a.trigger_reason || '—'}</span>
          <span className="alert-log-time">{shortTime(a.created_at || a.dispatched_at)}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text, icon = 'activity' }) {
  return (
    <div className="ops-empty">
      <Icon n={icon} />
      <span>{text}</span>
    </div>
  );
}

// ── Spike Area Chart ─────────────────────────────────────────────────────────

function SpikeAreaChart({ labels, series }) {
  const [hover, setHover] = useState(null);
  const W = 680;
  const H = 220;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.data));

  const xAt = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const yAt = (v) => padT + innerH - (v / max) * innerH;

  const primary = series.find((s) => s.primary) || series[0];
  const line = (s) => s.data.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
  const area =
    `M ${xAt(0)},${padT + innerH} ` +
    primary.data.map((v, i) => `L ${xAt(i)},${yAt(v)}`).join(' ') +
    ` L ${xAt(n - 1)},${padT + innerH} Z`;

  const gridYs = [0.25, 0.5, 0.75, 1].map((f) => padT + innerH - f * innerH);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };

  const tipLeft = hover == null ? 0 : Math.min(88, Math.max(12, (xAt(hover) / W) * 100));

  return (
    <div className="spike-chart">
      <svg
        className="spike-svg"
        viewBox={`0 0 ${W} ${H}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="District delay spike chart"
      >
        <defs>
          <linearGradient id="spikeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff5b22" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#ff5b22" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {gridYs.map((y, i) => (
          <line key={i} className="spike-grid" x1={padL} y1={y} x2={W - padR} y2={y} />
        ))}

        {/* Y-axis labels */}
        {gridYs.map((y, i) => (
          <text key={`yl-${i}`} className="spike-ylabel" x={padL} y={y - 3}>
            {Math.round(max * [0.25, 0.5, 0.75, 1][i])}m
          </text>
        ))}

        {/* Gradient fill for primary */}
        <path d={area} fill="url(#spikeFill)" />

        {/* Secondary series lines */}
        {series
          .filter((s) => !s.primary)
          .map((s) => (
            <polyline
              key={s.key}
              points={line(s)}
              fill="none"
              stroke={s.color}
              strokeWidth="1.5"
              strokeOpacity="0.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

        {/* Primary series line */}
        <polyline
          points={line(primary)}
          fill="none"
          stroke="#ff5b22"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* X-axis labels */}
        {labels.map((l, i) =>
          i % 2 === 0 ? (
            <text key={i} className="spike-xlabel" x={xAt(i)} y={H - 8} textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}

        {/* Hover crosshair */}
        {hover != null && (
          <g>
            <line
              className="spike-guide"
              x1={xAt(hover)}
              y1={padT}
              x2={xAt(hover)}
              y2={padT + innerH}
            />
            {series.map((s) => (
              <circle
                key={s.key}
                cx={xAt(hover)}
                cy={yAt(s.data[hover])}
                r="4"
                fill={s.color}
                stroke="#111"
                strokeWidth="2"
              />
            ))}
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hover != null && (
        <div className="spike-tip" style={{ left: `${tipLeft}%` }}>
          <div className="spike-tip-time">{labels[hover]}</div>
          {series.map((s) => (
            <div className="spike-tip-row" key={s.key}>
              <span className="spike-tip-dot" style={{ background: s.color }} />
              <span className="spike-tip-key">{s.key}</span>
              <span className="spike-tip-val">{s.data[hover]}m</span>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="spike-legend">
        {series.map((s) => (
          <span className="spike-legend-item" key={s.key}>
            <span className="spike-legend-dot" style={{ background: s.color }} />
            {s.key}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Inline Icon Set ──────────────────────────────────────────────────────────

const ICON_PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  refresh: (
    <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>
  ),
  truck: (
    <>
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </>
  ),
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  map: (
    <>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </>
  ),
  package: (
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  ),
  cpu: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  medicine: (
    <>
      <rect x="4" y="9" width="16" height="6" rx="3" />
      <line x1="12" y1="9" x2="12" y2="15" />
    </>
  ),
  grain: (
    <>
      <path d="M12 2v20" />
      <path d="M12 9c-3.5 0-5-2.2-5-5 3.5 0 5 2.2 5 5z" />
      <path d="M12 9c3.5 0 5-2.2 5-5-3.5 0-5 2.2-5 5z" />
      <path d="M12 16c-3.5 0-5-2.2-5-5 3.5 0 5 2.2 5 5z" />
      <path d="M12 16c3.5 0 5-2.2 5-5-3.5 0-5 2.2-5 5z" />
    </>
  ),
  fuel: (
    <>
      <line x1="3" y1="22" x2="15" y2="22" />
      <line x1="4" y1="9" x2="14" y2="9" />
      <path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" />
      <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5" />
    </>
  ),
  box: (
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  ),
  ambulance: (
    <>
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
      <line x1="6" y1="8" x2="6" y2="12" />
      <line x1="4" y1="10" x2="8" y2="10" />
    </>
  ),
};

function Icon({ n, className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[n] || ICON_PATHS.box}
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function commodityIcon(type) {
  return (
    {
      MEDICINE: 'medicine',
      PHARMA: 'medicine',
      FOOD_GRAINS: 'grain',
      FUEL: 'fuel',
      GENERAL: 'box',
    }[type] || 'box'
  );
}

function vehicleTypeIcon(type) {
  const t = type?.toUpperCase() || '';
  if (t.includes('AMBULANCE')) return 'ambulance';
  if (t.includes('UTIL')) return 'box';
  return 'truck';
}

function labelCase(str) {
  if (!str) return '—';
  return str
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function shortTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


/**
 * Real district delay series, bucketed from the reroute audit's actual
 * events — replaces a previous version that plotted a seeded random walk
 * under hardcoded district names ("Imphal Corridor", "Silchar", "Guwahati")
 * that do not correspond to any district in the current fleet. A chart with
 * invented numbers under real-looking axis labels is worse than no chart.
 *
 * Buckets into 2-hour windows across the lookback window, one series per
 * origin district — the top three by total delay, so a district that never
 * shows up in the audit never appears as a flat fabricated line either.
 */
const SPIKE_COLORS = ['#ff5b22', '#ffffff', '#9ca3af'];

function buildSpikeSeriesFromAudit(events, lookbackHours = 24) {
  const bucketCount = Math.max(1, Math.round(lookbackHours / 2));
  const now = new Date();
  const labels = [];
  const bucketStarts = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 2 * 3600 * 1000);
    labels.push(`${String(d.getHours()).padStart(2, '0')}:00`);
    bucketStarts.push(now.getTime() - (i + 1) * 2 * 3600 * 1000);
  }

  if (!events || events.length === 0) {
    return { labels, series: [], empty: true };
  }

  // Total delay per origin, to pick which districts earn a line.
  const totalsByOrigin = new Map();
  for (const evt of events) {
    const origin = evt.origin || 'Unknown';
    totalsByOrigin.set(origin, (totalsByOrigin.get(origin) || 0) + Math.abs(evt.delay_minutes || 0));
  }
  const topOrigins = [...totalsByOrigin.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([origin]) => origin);

  const series = topOrigins.map((origin, idx) => {
    const data = new Array(bucketCount).fill(0);
    for (const evt of events) {
      if (evt.origin !== origin || !evt.created_at) continue;
      const t = new Date(evt.created_at).getTime();
      const bucket = bucketStarts.findIndex((start, i) => {
        const end = i < bucketCount - 1 ? bucketStarts[i + 1] : now.getTime();
        return t >= start && t < end;
      });
      if (bucket >= 0) data[bucket] += Math.abs(evt.delay_minutes || 0);
    }
    return {
      key: origin,
      color: SPIKE_COLORS[idx] || '#9ca3af',
      primary: idx === 0,
      data: data.map((v) => Math.round(v)),
    };
  });

  return { labels, series, empty: series.every((s) => s.data.every((v) => v === 0)) };
}