/**
 * Government Fleet Manager portal (issue #65).
 *
 * The bureaucratic origin point: authorities provision vehicles here and the
 * NavNER command centre consumes them. Layout follows the VAHAN reference —
 * navy chrome, five KPI blocks over dense breakdown tables, charts beneath.
 */
import { useMemo, useState } from 'react';
import { BarPanel } from './components/BarPanel';
import { GovtHeader } from './components/GovtHeader';
import { KpiBlock } from './components/KpiBlock';
import { RegisterFleetModal } from './components/RegisterFleetModal';
import { seedScenarioFleet, useGovtDashboard } from './hooks/useGovtDashboard';

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

  const { summary, fleet, loading, error, reload } = useGovtDashboard({ zone, status });

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

      <div className="govt-status">
        <span>
          Fleet in view: <strong>{visibleFleet.length}</strong>
          {fleet?.fleet_count != null && visibleFleet.length !== fleet.fleet_count && (
            <> of {fleet.fleet_count} matching the selected zone</>
          )}
        </span>
        <span>
          {summary?.generated_at
            ? `Generated ${new Date(summary.generated_at).toLocaleString('en-IN')}`
            : 'Awaiting data'}
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
