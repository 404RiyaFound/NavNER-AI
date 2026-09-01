/**
 * AnalyticsDashboard — Centralized Operations Intelligence (/analytics)
 *
 * Ultra-modern dark monochromatic theme with a single vibrant-orange accent.
 * Layout (matches logistic_dashboard.jpg reference):
 *   ┌──────┬──────────────────────────────────────────────────────────┐
 *   │ rail │ topbar: title · search (pill) · Generate Report (pill)   │
 *   │ icon ├──────────────┬──────────────────────┬────────────────────┤
 *   │ nav  │ KPI stack    │ Delay Prediction     │ Reroute Audit      │
 *   │      │ (top = solid │ Matrix               │ Timeline (24h)     │
 *   │      │  orange)     │ District Spike Chart │                    │
 *   └──────┴──────────────┴──────────────────────┴────────────────────┘
 *
 * Data comes from the four /api/v1/dashboard/* endpoints via useAnalytics.
 * The district spike series is synthesised once on mount (no time-series
 * endpoint exists yet) using a seeded RNG so it stays stable across refreshes.
 */
import { useMemo, useState } from 'react';
import { useAnalytics } from '../hooks/useAnalytics';

export function AnalyticsDashboard() {
  const {
    consignmentState,
    delayPrediction,
    rerouteAudit,
    loading,
    error,
    refetch,
  } = useAnalytics({ enabled: true, refreshInterval: 30000 });

  const [query, setQuery] = useState('');
  const spike = useMemo(() => buildSpikeSeries(), []);

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

  const q = query.trim().toLowerCase();
  const predictions = (delayPrediction?.predictions || []).filter((p) =>
    !q ||
    `${p.vehicle_name} ${p.origin} ${p.destination} ${p.commodity_type}`
      .toLowerCase()
      .includes(q)
  );
  const events = (rerouteAudit?.events || []).filter((e) =>
    !q ||
    `${e.vehicle_name} ${e.origin} ${e.destination} ${e.trigger_reason}`
      .toLowerCase()
      .includes(q)
  );

  const updatedAt = consignmentState?.generated_at
    ? new Date(consignmentState.generated_at).toLocaleTimeString()
    : null;

  return (
    <div className="ops-dash" id="analytics-dashboard">
      {/* ── Left icon navigation ribbon ─────────────────────────────── */}
      <nav className="ops-rail" aria-label="Operations sections">
        <div className="ops-rail-logo">N</div>
        <div className="ops-rail-nav">
          <RailBtn n="map" label="Live Map" />
          <RailBtn n="activity" label="Analytics" active />
          <RailBtn n="truck" label="Fleet" />
          <RailBtn n="route" label="Routes" />
          <RailBtn n="alert" label="Alerts" />
          <RailBtn n="file" label="Reports" />
        </div>
        <RailBtn n="settings" label="Settings" />
      </nav>

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="ops-main">
        <header className="ops-topbar">
          <div className="ops-topbar-title">
            <h1>Operations Analytics</h1>
            <p>Multi-district intelligence · NER supply chain</p>
          </div>

          <label className="ops-search">
            <Icon n="search" />
            <input
              type="text"
              placeholder="Search vehicles, routes, districts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <div className="ops-topbar-actions">
            {updatedAt && <span className="ops-updated">Updated {updatedAt}</span>}
            <button
              className="ops-icon-btn"
              onClick={refetch}
              title="Refresh"
              aria-label="Refresh analytics"
            >
              <Icon n="refresh" />
            </button>
            <button className="ops-report-btn" onClick={() => window.print()}>
              <Icon n="plus" /> Generate Report
            </button>
          </div>
        </header>

        <div className="ops-grid">
          {/* ── Column 1 — KPI stack ──────────────────────────────── */}
          <div className="ops-col ops-col--kpi">
            <KpiCard
              primary
              icon="truck"
              value={consignmentState?.total_active_consignments ?? 0}
              label="Active Consignments"
              sub="On the way"
            />
            <KpiCard
              icon="activity"
              value={consignmentState?.total_running_fleet ?? 0}
              label="Running Fleet"
              sub="Vehicles in motion"
            />
            <KpiCard
              icon="alert"
              value={delayPrediction?.summary?.critical_risk ?? 0}
              label="Critical Risk Trips"
              sub="High delay probability"
              dot
            />
            <KpiCard
              icon="route"
              value={rerouteAudit?.summary?.total_reroutes ?? 0}
              label="Reroutes · 24h"
              sub={`${rerouteAudit?.summary?.total_delay_minutes ?? 0}m added`}
            />
          </div>

          {/* ── Column 2 — Matrix + Spike chart ───────────────────── */}
          <div className="ops-col ops-col--center">
            <section className="ops-panel" id="panel-delay-prediction">
              <div className="ops-panel-head">
                <h2>AI Delay Prediction Matrix</h2>
                <span className="ops-tag">ML-powered</span>
              </div>

              {predictions.length > 0 ? (
                <div className="matrix">
                  <div className="matrix-row matrix-row--head">
                    <span>Vehicle</span>
                    <span>Route</span>
                    <span>Commodity</span>
                    <span className="matrix-prob-col">Delay Prob.</span>
                  </div>
                  {predictions.map((p, i) => {
                    const pct = Math.round((p.delay_probability ?? 0) * 100);
                    const critical = /CRITICAL|HIGH/.test(p.risk_classification || '');
                    return (
                      <div className="matrix-row" key={i}>
                        <span className="m-vehicle">{p.vehicle_name}</span>
                        <span className="m-route" title={`${p.origin} → ${p.destination}`}>
                          {p.origin} <span className="m-arrow">→</span> {p.destination}
                        </span>
                        <span className="m-commodity">
                          <Icon n={commodityIcon(p.commodity_type)} />
                          {labelCase(p.commodity_type)}
                        </span>
                        <span className="m-prob">
                          <span className="prob-bar">
                            <span
                              className={`prob-fill ${critical ? 'is-critical' : 'is-moderate'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className="prob-num">{pct}%</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty text={q ? 'No matches for this search' : 'No delay predictions'} />
              )}
            </section>

            <section className="ops-panel" id="panel-district-spikes">
              <div className="ops-panel-head">
                <h2>District-Wise Delay Spikes</h2>
                <span className="ops-tag">last 24h</span>
              </div>
              <SpikeAreaChart labels={spike.labels} series={spike.series} />
            </section>
          </div>

          {/* ── Column 3 — Reroute audit timeline ─────────────────── */}
          <div className="ops-col ops-col--right">
            <section className="ops-panel ops-panel--timeline" id="panel-reroute-audit">
              <div className="ops-panel-head">
                <h2>Reroute Audit</h2>
                <span className="ops-tag">
                  {rerouteAudit?.summary?.total_reroutes ?? events.length} events
                </span>
              </div>

              {events.length > 0 ? (
                <ol className="timeline">
                  {events.map((evt, i) => (
                    <li className="timeline-item" key={i}>
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
                                  evt.delay_minutes > 0 ? 'timeline-delay' : 'timeline-delay is-gain'
                                }
                              >
                                {evt.delay_minutes > 0 ? '+' : ''}
                                {evt.delay_minutes}m delay
                              </span>
                            </>
                          ) : null}
                        </p>
                        <p className="timeline-route">
                          {evt.origin} <span className="m-arrow">→</span> {evt.destination}
                          <Icon n={commodityIcon(evt.commodity_type)} className="timeline-cargo" />
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty text={q ? 'No matches for this search' : 'No reroutes in the last 24h'} />
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
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function RailBtn({ n, label, active }) {
  return (
    <button className={`ops-rail-btn ${active ? 'active' : ''}`} title={label} aria-label={label}>
      <Icon n={n} />
    </button>
  );
}

function KpiCard({ primary, icon, value, label, sub, dot }) {
  return (
    <div className={`kpi-card ${primary ? 'kpi-card--primary' : ''}`}>
      <span className="kpi-icon">
        <Icon n={icon} />
      </span>
      <span className="kpi-value">
        {value}
        {dot && <span className="kpi-dot" />}
      </span>
      <span className="kpi-label">{label}</span>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="ops-empty">
      <Icon n="activity" />
      <span>{text}</span>
    </div>
  );
}

function SpikeAreaChart({ labels, series }) {
  const [hover, setHover] = useState(null);
  const W = 660;
  const H = 236;
  const padL = 6;
  const padR = 6;
  const padT = 14;
  const padB = 24;
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
      >
        <defs>
          <linearGradient id="spikeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff5b22" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#ff5b22" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridYs.map((y, i) => (
          <line key={i} className="spike-grid" x1={padL} y1={y} x2={W - padR} y2={y} />
        ))}

        <path d={area} fill="url(#spikeFill)" />

        {series
          .filter((s) => !s.primary)
          .map((s) => (
            <polyline
              key={s.key}
              points={line(s)}
              fill="none"
              stroke={s.color}
              strokeWidth="1.5"
              strokeOpacity="0.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

        <polyline
          points={line(primary)}
          fill="none"
          stroke="#ff5b22"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {labels.map((l, i) =>
          i % 2 === 0 ? (
            <text key={i} className="spike-xlabel" x={xAt(i)} y={H - 7} textAnchor="middle">
              {l}
            </text>
          ) : null
        )}

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
                r="3.6"
                fill={s.color}
                stroke="#1c1c1c"
                strokeWidth="1.6"
              />
            ))}
          </g>
        )}
      </svg>

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

// ── Inline icon set (monochrome, stroke-based) ──────────────────────────────

const ICON_PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
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
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
      <path d="M12 16c3.5 0 5-2.2 5-5 3.5 0 5 2.2 5 5z" />
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
};

function Icon({ n, className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
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

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthesised district delay series — 12 two-hour buckets across the last 24h. */
function buildSpikeSeries() {
  const rand = mulberry32(20260902);
  const now = new Date();
  const labels = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 2 * 3600 * 1000);
    labels.push(`${String(d.getHours()).padStart(2, '0')}:00`);
  }
  const mk = (base, amp, spikeAt, spikeMag) =>
    labels.map((_, i) => {
      let v = base + Math.sin(i / 1.7) * amp + (rand() - 0.5) * amp;
      if (i >= spikeAt) v += spikeMag * ((i - spikeAt + 1) / (12 - spikeAt));
      return Math.max(0, Math.round(v));
    });
  return {
    labels,
    series: [
      { key: 'Imphal Corridor', color: '#ff5b22', primary: true, data: mk(26, 9, 7, 44) },
      { key: 'Silchar', color: '#ffffff', data: mk(17, 6, 8, 12) },
      { key: 'Guwahati', color: '#9ca3af', data: mk(11, 5, 9, 6) },
    ],
  };
}
