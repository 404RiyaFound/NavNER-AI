/**
 * Top bar and filter strip, modelled on the VAHAN dashboard chrome: emblem and
 * title on navy, then a darker strip of white select controls.
 */

const COMMODITIES = ['All Commodities', 'FOOD_GRAINS', 'MEDICINE', 'FUEL', 'GENERAL'];

const ZONES = [
  { value: 'all', label: 'All NER States/UTs' },
  { value: 'assam_flood', label: 'Assam — Flood Affected' },
  { value: 'Cachar', label: 'Cachar (Silchar)' },
  { value: 'Majuli', label: 'Majuli' },
  { value: 'Golaghat', label: 'Golaghat (Kaziranga)' },
  { value: 'Morigaon', label: 'Morigaon' },
  { value: 'Aizawl', label: 'Aizawl' },
  { value: 'Imphal West', label: 'Imphal West' },
  { value: 'East Khasi Hills', label: 'East Khasi Hills' },
  { value: 'Dibrugarh', label: 'Dibrugarh' },
];

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'deployed', label: 'Deployed (In Transit / Rerouted)' },
];

export function GovtHeader({
  commodity, onCommodity,
  zone, onZone,
  status, onStatus,
  onRefresh, loading,
}) {
  return (
    <>
      <div className="govt-topbar">
        <div className="govt-brand">
          <div className="govt-emblem" aria-hidden="true">&#9733;</div>
          <div>
            <div className="govt-title">GOVERNMENT FLEET DASHBOARD</div>
            <div className="govt-subtitle">
              NavNER-AI &middot; North Eastern Region Logistics Provisioning
            </div>
          </div>
        </div>
        <div className="govt-topbar-right">
          <span>Main Page View</span>
        </div>
      </div>

      <div className="govt-filters">
        <div className="govt-filter">
          <label htmlFor="f-commodity">Commodity Type</label>
          <select
            id="f-commodity"
            value={commodity}
            onChange={(e) => onCommodity(e.target.value)}
          >
            {COMMODITIES.map(c => (
              <option key={c} value={c}>{c.replace('_', ' ')}</option>
            ))}
          </select>
        </div>

        <div className="govt-filter">
          <label htmlFor="f-zone">State/UTs &middot; District</label>
          <select id="f-zone" value={zone} onChange={(e) => onZone(e.target.value)}>
            {ZONES.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
          </select>
        </div>

        <div className="govt-filter">
          <label htmlFor="f-status">RTO / Deployment</label>
          <select id="f-status" value={status} onChange={(e) => onStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <button
          className="govt-refresh"
          onClick={onRefresh}
          disabled={loading}
          title="Reload dashboard data"
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      <div className="govt-notice">
        Figures reflect vehicles provisioned through this portal and are consumed
        live by the NavNER command centre.
      </div>
    </>
  );
}
