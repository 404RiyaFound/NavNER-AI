/**
 * Data for the government fleet dashboard.
 *
 * In dev the Vite proxy forwards /api to the backend on the same origin, so no
 * base URL is needed; VITE_API_URL only matters for a build served elsewhere.
 */
import { useCallback, useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json();
}

export function useGovtDashboard({ zone = 'all', status = '', commodity = '' } = {}) {
  const [summary, setSummary] = useState(null);
  const [fleet, setFleet] = useState(null);
  const [transit, setTransit] = useState(null);
  const [loading, setLoading] = useState(true);
  // Held and surfaced, not swallowed. A government dashboard showing zeroes
  // because a fetch failed is worse than one that says it could not load.
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (zone) params.set('zone', zone);
      if (status) params.set('status', status);

      const transitParams = new URLSearchParams(params);
      if (commodity && commodity !== 'All Commodities') {
        transitParams.set('commodity', commodity);
      }

      const [s, f, t] = await Promise.all([
        getJson('/api/v1/govt/dashboard-summary'),
        getJson(`/api/v1/govt/active-fleet?${params.toString()}`),
        getJson(`/api/v1/govt/transit-log?${transitParams.toString()}`),
      ]);
      setSummary(s);
      setFleet(f);
      setTransit(t);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [zone, status, commodity]);

  useEffect(() => { load(); }, [load]);

  return { summary, fleet, transit, setTransit, loading, error, reload: load };
}

export async function registerVehicle(payload) {
  const res = await fetch(`${API_BASE}/api/v1/govt/fleet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    // 409 is a duplicate plate and 422 a validation failure — both are things
    // the operator can fix, so the message has to reach the form.
    let detail = `Registration failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail) && body.detail.length) {
        detail = body.detail.map(d => `${d.loc?.at(-1)}: ${d.msg}`).join('; ');
      }
    } catch { /* non-JSON error body — keep the status message */ }
    throw new Error(detail);
  }
  return res.json();
}

export async function seedScenarioFleet() {
  const res = await fetch(`${API_BASE}/api/v1/govt/simulate/seed`, { method: 'POST' });
  if (!res.ok) throw new Error(`Seeding failed (${res.status})`);
  return res.json();
}
