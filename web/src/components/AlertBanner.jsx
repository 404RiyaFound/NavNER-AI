/**
 * AlertBanner — Emergency alert bar for CRITICAL and HIGH risk segments.
 *
 * Pinned at top of the dashboard with a pulsing animation. Shows active
 * high-risk corridor segments. Auto-reappears on new critical alerts.
 */
import { useState, useEffect, useMemo } from 'react';

export function AlertBanner({ hazardData, riskUpdate }) {
  const [dismissed, setDismissed] = useState(false);

  // Extract critical and high risk features
  const alerts = useMemo(() => {
    if (!hazardData?.features) return [];
    return hazardData.features.filter(
      (f) => f.properties?.risk_level === 'CRITICAL' || f.properties?.risk_level === 'HIGH'
    );
  }, [hazardData]);

  const criticalCount = useMemo(
    () => alerts.filter((a) => a.properties?.risk_level === 'CRITICAL').length,
    [alerts]
  );
  const highCount = useMemo(
    () => alerts.filter((a) => a.properties?.risk_level === 'HIGH').length,
    [alerts]
  );

  // Auto-reappear when new risk update arrives with critical/high segments
  useEffect(() => {
    if (riskUpdate && (riskUpdate.critical_count > 0 || riskUpdate.high_count > 0)) {
      setDismissed(false);
    }
  }, [riskUpdate]);

  // Don't render if no alerts or dismissed
  if (alerts.length === 0 || dismissed) return null;

  // Collect unique districts
  const districts = [...new Set(alerts.map((a) => a.properties?.district).filter(Boolean))];

  return (
    <div
      className={`alert-banner ${criticalCount > 0 ? 'critical' : 'high'}`}
      id="emergency-alert-banner"
    >
      <div className="alert-banner-content">
        <span className="alert-banner-icon">
          {criticalCount > 0 ? '🚨' : '⚠️'}
        </span>
        <div className="alert-banner-text">
          <strong>
            {criticalCount > 0
              ? `${criticalCount} CRITICAL`
              : `${highCount} HIGH RISK`}
            {criticalCount > 0 && highCount > 0 && ` + ${highCount} HIGH`}
            {' '}alert{alerts.length !== 1 ? 's' : ''} active
          </strong>
          <span className="alert-banner-corridors">
            Affected corridors: {districts.slice(0, 4).join(', ')}
            {districts.length > 4 && ` +${districts.length - 4} more`}
          </span>
        </div>
      </div>
      <button
        className="alert-banner-dismiss"
        onClick={() => setDismissed(true)}
        title="Dismiss"
        id="alert-dismiss-btn"
      >
        ✕
      </button>
    </div>
  );
}
