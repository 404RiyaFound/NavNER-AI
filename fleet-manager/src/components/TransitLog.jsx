/**
 * Commodity vehicle transit summary — the detailed per-vehicle list.
 *
 * The KPI blocks answer "how many"; this answers "which vehicle, where, and
 * what has happened to it". One row per vehicle in transit, expandable to its
 * transition history, driven by the same filter controls as the rest of the
 * page and patched in place by live WebSocket events.
 *
 * Rows that changed in the last few seconds are marked, so an operator can see
 * what just moved instead of watching numbers change silently.
 */
import { useState } from 'react';

const STATUS_STYLE = {
  IN_TRANSIT: { bg: '#DBEAFE', fg: '#1E40AF', label: 'IN TRANSIT' },
  REROUTED:   { bg: '#FEF3C7', fg: '#92400E', label: 'REROUTED' },
  PENDING:    { bg: '#F3F4F6', fg: '#374151', label: 'PENDING' },
  COMPLETED:  { bg: '#DCFCE7', fg: '#166534', label: 'COMPLETED' },
};

const PRIORITY_STYLE = {
  EMERGENCY:     { fg: '#B91C1C' },
  HIGH_PRIORITY: { fg: '#B45309' },
  STANDARD:      { fg: '#374151' },
};

function StatusChip({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
  return (
    <span className="chip" style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function fmtCoords(c) {
  if (!c) return '—';
  return `${c.lat.toFixed(4)}°N, ${c.lng.toFixed(4)}°E`;
}

function TransitionList({ transitions }) {
  if (!transitions || transitions.length === 0) {
    return <div className="kpi-empty">No transitions recorded</div>;
  }
  return (
    <ol className="transition-list">
      {transitions.map((t, i) => (
        <li key={`${t.at}-${i}`} className={`transition kind-${t.kind}`}>
          <span className="transition-kind">{t.kind.replace(/_/g, ' ')}</span>
          <span className="transition-time">{fmtTime(t.at)}</span>
          <span className="transition-detail">{t.detail}</span>
          {t.delay_minutes != null && t.delay_minutes !== 0 && (
            <span className="transition-delay">
              {t.delay_minutes > 0 ? `+${t.delay_minutes}` : t.delay_minutes} min
            </span>
          )}
          {(t.old_eta || t.new_eta) && (
            <span className="transition-eta">
              ETA {fmtTime(t.old_eta)} &rarr; {fmtTime(t.new_eta)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function TransitLog({ log, loading, error, live, recentIds }) {
  const [expanded, setExpanded] = useState(() => new Set());

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const vehicles = log?.vehicles ?? [];

  return (
    <div className="panel transit-panel">
      <div className="panel-head transit-head">
        <span>COMMODITY VEHICLE TRANSIT SUMMARY</span>
        <span className="transit-head-meta">
          <span className={`live-dot ${live.connected ? 'on' : 'off'}`} />
          {live.connected ? 'LIVE SYNC' : 'RECONNECTING'}
          {live.eventCount > 0 && <> &middot; {live.eventCount} events</>}
        </span>
      </div>

      {/* A disconnected feed must say so rather than let a frozen list read as
          current. */}
      {!live.connected && (
        <div className="transit-warn">
          Live sync is disconnected — positions and statuses below may be stale.
        </div>
      )}
      {error && <div className="transit-warn">Could not load transit log — {error}</div>}

      <div className="transit-totals">
        <span><strong>{log?.vehicle_count ?? 0}</strong> vehicles in transit</span>
        <span><strong>{log?.total_reroutes ?? 0}</strong> reroutes</span>
        <span><strong>{log?.total_delay_minutes ?? 0}</strong> min cumulative delay</span>
        {loading && <span className="govt-hint">refreshing…</span>}
      </div>

      <div className="transit-scroll">
        <table className="govt-table transit-table">
          <thead>
            <tr>
              <th style={{ width: 22 }} aria-label="Expand" />
              <th>Vehicle No.</th>
              <th>Class</th>
              <th>Commodity</th>
              <th>Priority</th>
              <th>Route</th>
              <th>District</th>
              <th className="num">Cap. (t)</th>
              <th>Status</th>
              <th>Current Position</th>
              <th>ETA</th>
              <th className="num">Reroutes</th>
              <th className="num">Delay</th>
              <th>Handover</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 && !loading && (
              <tr>
                <td colSpan={14} className="kpi-empty">
                  No vehicles in transit for the selected filters
                </td>
              </tr>
            )}

            {vehicles.map((v) => {
              const open = expanded.has(v.vehicle_id);
              const justChanged = recentIds.has(v.vehicle_id);
              return [
                <tr
                  key={v.vehicle_id}
                  className={`transit-row${justChanged ? ' just-changed' : ''}`}
                  onClick={() => toggle(v.vehicle_id)}
                >
                  <td className="expander">{open ? '▾' : '▸'}</td>
                  <td className="mono">{v.vid}</td>
                  <td>{v.vehicle_class.replace(/_/g, ' ')}</td>
                  <td>{v.commodity?.replace(/_/g, ' ') ?? '—'}</td>
                  <td style={{ color: (PRIORITY_STYLE[v.priority] ?? {}).fg }}>
                    {v.priority?.replace(/_/g, ' ') ?? '—'}
                  </td>
                  <td>{v.origin} &rarr; {v.destination}</td>
                  <td>{v.target_district ?? '—'}</td>
                  <td className="num">{v.cargo_capacity_tons ?? '—'}</td>
                  <td><StatusChip status={v.status} /></td>
                  <td className="mono">{fmtCoords(v.current_coords)}</td>
                  <td>{fmtTime(v.estimated_arrival)}</td>
                  <td className="num">{v.reroute_count}</td>
                  <td className="num">
                    {v.total_delay_minutes ? `+${v.total_delay_minutes}m` : '—'}
                  </td>
                  <td className="mono">{v.local_pickup_linked ?? '—'}</td>
                </tr>,
                open && (
                  <tr key={`${v.vehicle_id}-detail`} className="transit-detail-row">
                    <td colSpan={14}>
                      <div className="transit-detail">
                        <div className="transit-detail-grid">
                          <div><span>Trip ID</span><code>{v.trip_id ?? '—'}</code></div>
                          <div><span>Depot origin</span><code>{v.depot_origin ?? '—'}</code></div>
                          <div><span>Organization</span><code>{v.organization ?? '—'}</code></div>
                          <div><span>Last telemetry</span><code>{fmtTime(v.last_ping)}</code></div>
                          <div><span>Last rerouted</span><code>{fmtTime(v.last_rerouted_at)}</code></div>
                          <div><span>Vehicle ID</span><code>{v.vehicle_id}</code></div>
                        </div>
                        <div className="transition-title">Transition history</div>
                        <TransitionList transitions={v.transitions} />
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
