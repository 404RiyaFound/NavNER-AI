/**
 * One VAHAN-style KPI block: a flat colour rectangle with a large number at the
 * top left and its label beneath, then the dense breakdown table directly under
 * it, per issue §5.
 *
 * The block colours are chrome, not a data encoding — they identify the metric.
 * Magnitude is carried by the numbers and by bar length in the charts below.
 */

/**
 * "% Growth" against the previous 30-day window, computed by the backend from
 * vehicles.created_at.
 *
 * A district with no registrations in the prior window shows an em dash, not a
 * number: percentage growth from zero is undefined, and printing 0% or 100%
 * there would put an invented trend on a government dashboard.
 */
function GrowthCell({ pct }) {
  if (pct === null || pct === undefined) {
    return <td className="num delta-none" title="No prior period to compare">&mdash;</td>;
  }
  const up = pct >= 0;
  return (
    <td className={`num ${up ? 'delta-up' : 'delta-down'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
    </td>
  );
}

export function KpiBlock({ color, label, value, rows, tableTitle, rowHeader = 'District' }) {
  return (
    <div>
      <div className="kpi-block" style={{ background: color }}>
        <div className="kpi-value">{value?.toLocaleString('en-IN') ?? '—'}</div>
        <div className="kpi-label">{label}</div>
      </div>

      <div className="kpi-table-wrap">
        <div className="kpi-table-title" style={{ color }}>
          {tableTitle ?? label}
        </div>

        {rows && rows.length > 0 ? (
          <table className="govt-table">
            <thead>
              <tr>
                <th>{rowHeader}</th>
                <th className="num">Count</th>
                <th className="num">% Growth</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{String(r.label).replace(/_/g, ' ')}</td>
                  <td className="num">{Number(r.count).toLocaleString('en-IN')}</td>
                  <GrowthCell pct={r.growth_pct} />
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="kpi-empty">No breakdown available</div>
        )}
      </div>
    </div>
  );
}
