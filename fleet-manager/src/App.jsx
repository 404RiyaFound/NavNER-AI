/**
 * Government Fleet Manager portal (issue #65).
 *
 * The bureaucratic origin point: authorities provision vehicles here and the
 * NavNER command centre consumes them. Layout follows the VAHAN reference —
 * navy chrome, five KPI blocks over dense breakdown tables, charts beneath.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarPanel } from './components/BarPanel';
import { GovtHeader } from './components/GovtHeader';
import { KpiBlock } from './components/KpiBlock';
import { RegisterFleetModal } from './components/RegisterFleetModal';
import { TransitLog } from './components/TransitLog';
import { seedScenarioFleet, useGovtDashboard } from './hooks/useGovtDashboard';
import { useLiveSync } from './hooks/useLiveSync';

// Block fills per issue §5 (Tailwind bg-blue-400 / green-500 / yellow-500 /
// red-500 / blue-600), read from CSS custom properties so the theme stays in
// one place.
const BLOCK_COLORS = {
  total_fleet: 'var(--kpi-blue)',
  active_routes: 'var(--kpi-green)',
  last_mile: 'var(--kpi-yellow)',
  stranded: 'var(--kpi-red)',
  clearance_rate: 'var(--kpi-royal)',
};

const BLOCK_ROW_HEADERS = {
  total_fleet: 'District',
  active_routes: 'Trip Status',
  last_mile: 'Vehicle Class',
  stranded: 'Flood District',
  clearance_rate: 'Indicator',
};

export default function App() {
  const [commodity, setCommodity] = useState('All Commodities');
  const [zone, setZone] = useState('all');
  const [status, setStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [seedNote, setSeedNote] = useState(null);

  const { summary, fleet, transit, setTransit, loading, error, reload } =
    useGovtDashboard({ zone, status, commodity });

  // Vehicles touched by a live event, so the table can mark what just moved.
  // Entries age out rather than accumulating, otherwise every row ends up
  // highlighted and the cue stops meaning anything.
  const [recentIds, setRecentIds] = useState(() => new Set());
  const expiryTimers = useRef(new Map());

  const markRecent = useCallback((vehicleId) => {
    if (!vehicleId) return;
    setRecentIds((prev) => new Set(prev).add(vehicleId));

    clearTimeout(expiryTimers.current.get(vehicleId));
    expiryTimers.current.set(
      vehicleId,
      setTimeout(() => {
        setRecentIds((prev) => {
          const next = new Set(prev);
          next.delete(vehicleId);
          return next;
        });
        expiryTimers.current.delete(vehicleId);
      }, 6000),
    );
  }, []);

  useEffect(() => () => {
    for (const t of expiryTimers.current.values()) clearTimeout(t);
    expiryTimers.current.clear();
  }, []);

  // Telemetry patches coordinates in place. Refetching the whole log for a
  // position update would be wasteful at 50 vehicles on a 2s tick, and would
  // collapse any expanded row.
  const handleTelemetry = useCallback((data) => {
    setTransit((prev) => {
      if (!prev?.vehicles) return prev;
      let hit = false;
      const vehicles = prev.vehicles.map((v) => {
        if (v.vehicle_id !== data.vehicle_id) return v;
        hit = true;
        return {
          ...v,
          current_coords: { lat: data.lat, lng: data.lng },
          last_ping: data.timestamp,
        };
      });
      if (!hit) return prev;
      return { ...prev, vehicles };
    });
    markRecent(data.vehicle_id);
  }, [setTransit, markRecent]);

  // A reroute changes status and adds to the audit trail, so the transition is
  // prepended immediately instead of waiting for the next poll.
  const handleReroute = useCallback((data) => {
    setTransit((prev) => {
      if (!prev?.vehicles) return prev;
      let extraReroutes = 0;
      let extraDelay = 0;
      const vehicles = prev.vehicles.map((v) => {
        if (v.trip_id !== data.trip_id) return v;
        extraReroutes += 1;
        extraDelay += data.delay_minutes || 0;
        return {
          ...v,
          status: data.status || 'REROUTED',
          last_rerouted_at: data.timestamp,
          reroute_count: (v.reroute_count || 0) + 1,
          total_delay_minutes: (v.total_delay_minutes || 0) + (data.delay_minutes || 0),
          estimated_arrival: data.new_eta ?? v.estimated_arrival,
          transitions: [
            {
              at: data.timestamp,
              kind: 'REROUTED',
              detail:
                `Rerouted — ${data.avoided_hazards ?? 0} hazard(s) avoided, ` +
                `${data.new_distance_km ?? '?'} km`,
              delay_minutes: data.delay_minutes ?? null,
              new_eta: data.new_eta ?? null,
              old_eta: null,
            },
            ...(v.transitions || []),
          ],
        };
      });
      return {
        ...prev,
        vehicles,
        total_reroutes: (prev.total_reroutes || 0) + extraReroutes,
        total_delay_minutes: (prev.total_delay_minutes || 0) + extraDelay,
      };
    });
    markRecent(data.vehicle_id);
  }, [setTransit, markRecent]);

  const live = useLiveSync({
    onTelemetry: handleTelemetry,
    onReroute: handleReroute,
    onInvalidate: reload,
  });

  // Commodity is filtered client-side: the fleet payload already carries it, so
  // a round trip would add latency without adding information.
  const visibleFleet = useMemo(() => {
    if (!fleet?.vehicles) return [];
    if (commodity === 'All Commodities') return fleet.vehicles;
    return fleet.vehicles.filter(v => v.commodity === commodity);
  }, [fleet, commodity]);

  const commodityRows = useMemo(() => {
    if (!summary?.commodities_in_transit) return [];
    if (commodity === 'All Commodities') return summary.commodities_in_transit;
    return summary.commodities_in_transit.filter(r => r.label === commodity);
  }, [summary, commodity]);

  async function handleSeed() {
    setSeedNote('Provisioning scenario fleet…');
    try {
      const res = await seedScenarioFleet();
      setSeedNote(
        `Scenario fleet: ${res.created} created, ${res.already_present} already present ` +
        `(${res.total_in_scenario}/${res.requested}).`
      );
      reload();
    } catch (err) {
      setSeedNote(err.message);
    }
  }

  return (
    <>
      <GovtHeader
        commodity={commodity} onCommodity={setCommodity}
        zone={zone} onZone={setZone}
        status={status} onStatus={setStatus}
        onRefresh={reload} loading={loading}
      />

      {/* An unreachable backend must say so. Rendering zeroes in every block
          would look like a cleared region rather than a failed load. */}
      {error && (
        <div className="govt-error">
          Unable to load dashboard data — {error}. Figures below are not current.
        </div>
      )}

      <div className="kpi-row">
        {(summary?.blocks ?? []).map(block => (
          <KpiBlock
            key={block.key}
            color={BLOCK_COLORS[block.key] ?? 'var(--kpi-royal)'}
            label={block.label}
            value={block.value}
            rows={block.rows}
            rowHeader={BLOCK_ROW_HEADERS[block.key]}
          />
        ))}
      </div>

      <div className="govt-actions">
        <button className="govt-btn" onClick={() => setShowModal(true)}>
          + REGISTER NEW FLEET / DISPATCH VEHICLE
        </button>
        <button className="govt-btn govt-btn-secondary" onClick={handleSeed}>
          Provision Scenario Fleet (50)
        </button>
        {seedNote && <span className="govt-hint">{seedNote}</span>}
      </div>

      <div className="panel-row">
        <BarPanel
          title="Deployment by District"
          rows={summary?.deployment_by_district}
          color="var(--kpi-blue)"
        />
        <BarPanel
          title="Commodities in Transit"
          rows={commodityRows}
          color="var(--kpi-green)"
        />
      </div>

      <TransitLog
        log={transit}
        loading={loading}
        error={error}
        live={live}
        recentIds={recentIds}
      />

      <div className="govt-status">
        <span>
          Fleet in view: <strong>{visibleFleet.length}</strong>
          {fleet?.fleet_count != null && visibleFleet.length !== fleet.fleet_count && (
            <> of {fleet.fleet_count} matching the selected zone</>
          )}
        </span>
        <span>
          {live.lastEventAt
            ? `Last live event ${live.lastEventAt.toLocaleTimeString('en-IN')}`
            : 'No live events yet'}
          {' · '}
          {summary?.generated_at
            ? `generated ${new Date(summary.generated_at).toLocaleString('en-IN')}`
            : 'awaiting data'}
        </span>
      </div>

      {showModal && (
        <RegisterFleetModal
          onClose={() => setShowModal(false)}
          onRegistered={reload}
        />
      )}
    </>
  );
}
