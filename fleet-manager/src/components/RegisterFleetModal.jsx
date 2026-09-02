/**
 * "Register New Fleet" modal (issue §3.1, §5).
 *
 * The issue's §5 prompt names three inputs (Vehicle Number, Cargo, Target
 * District); §3.1 names five. The form carries all five because the API
 * requires them — a three-field submit would 422 — and vehicle class is what
 * distinguishes trunk haulage from last-mile capability everywhere else in the
 * dashboard.
 */
import { useState } from 'react';
import { registerVehicle } from '../hooks/useGovtDashboard';

const VEHICLE_CLASSES = [
  { value: 'HEAVY_TRUCK', label: 'Heavy Duty Truck' },
  { value: 'PICKUP_4X4', label: '4x4 Pickup' },
  { value: 'AMBULANCE', label: 'Ambulance' },
  { value: 'NDRF_BOAT', label: 'NDRF Boat' },
  { value: 'UTILITY', label: 'Utility' },
];

const DISTRICTS = [
  'Cachar', 'Majuli', 'Golaghat', 'Morigaon', 'Nagaon', 'Dhemaji', 'Lakhimpur',
  'Dibrugarh', 'Aizawl', 'Imphal West', 'East Khasi Hills',
];

const EMPTY = {
  license_plate: '',
  vehicle_class: 'HEAVY_TRUCK',
  cargo_capacity_tons: '',
  depot_origin: '',
  target_district: 'Cachar',
  organization: '',
};

export function RegisterFleetModal({ onClose, onRegistered }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function validate() {
    const errs = {};
    // Matches the Indian plate format the reference dashboard uses, e.g.
    // AS-01-X-1234. Kept permissive on the middle group so government series
    // like AS-01-FCI-9901 are accepted too.
    if (!/^[A-Z]{2}-\d{1,2}-[A-Z]{1,3}-\d{1,4}$/i.test(form.license_plate.trim())) {
      errs.license_plate = 'Format: AS-01-X-1234';
    }
    const tons = Number(form.cargo_capacity_tons);
    if (!form.cargo_capacity_tons || Number.isNaN(tons) || tons <= 0 || tons > 100) {
      errs.cargo_capacity_tons = 'Enter a capacity between 0 and 100 tonnes';
    }
    if (form.depot_origin.trim().length < 2) {
      errs.depot_origin = 'Depot origin is required';
    }
    return errs;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setBanner({ kind: 'error', text: 'Please correct the highlighted fields.' });
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      const created = await registerVehicle({
        license_plate: form.license_plate.trim().toUpperCase(),
        vehicle_class: form.vehicle_class,
        cargo_capacity_tons: Number(form.cargo_capacity_tons),
        depot_origin: form.depot_origin.trim(),
        target_district: form.target_district,
        organization: form.organization.trim() || null,
      });
      setBanner({ kind: 'ok', text: `${created.vid} registered successfully.` });
      setForm(EMPTY);
      onRegistered?.();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Register New Fleet">
        <div className="modal-head">
          <span>REGISTER NEW FLEET / DISPATCH VEHICLE</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body">
            {banner && (
              <div className={`form-banner ${banner.kind}`}>{banner.text}</div>
            )}

            <div className="form-grid">
              <div className="field">
                <label htmlFor="v-plate">
                  Vehicle Number <span className="field-req">*</span>
                </label>
                <input
                  id="v-plate" value={form.license_plate} onChange={set('license_plate')}
                  placeholder="AS-01-X-1234" autoComplete="off"
                />
                {fieldErrors.license_plate && (
                  <span className="field-error">{fieldErrors.license_plate}</span>
                )}
              </div>

              <div className="field">
                <label htmlFor="v-class">
                  Vehicle Class <span className="field-req">*</span>
                </label>
                <select id="v-class" value={form.vehicle_class} onChange={set('vehicle_class')}>
                  {VEHICLE_CLASSES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="v-cargo">
                  Cargo Capacity (Tonnes) <span className="field-req">*</span>
                </label>
                <input
                  id="v-cargo" type="number" step="0.5" min="0.5" max="100"
                  value={form.cargo_capacity_tons} onChange={set('cargo_capacity_tons')}
                  placeholder="18"
                />
                {fieldErrors.cargo_capacity_tons && (
                  <span className="field-error">{fieldErrors.cargo_capacity_tons}</span>
                )}
              </div>

              <div className="field">
                <label htmlFor="v-depot">
                  Depot Origin <span className="field-req">*</span>
                </label>
                <input
                  id="v-depot" value={form.depot_origin} onChange={set('depot_origin')}
                  placeholder="Guwahati Silo"
                />
                {fieldErrors.depot_origin && (
                  <span className="field-error">{fieldErrors.depot_origin}</span>
                )}
              </div>

              <div className="field">
                <label htmlFor="v-district">
                  Target District <span className="field-req">*</span>
                </label>
                <select id="v-district" value={form.target_district} onChange={set('target_district')}>
                  {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div className="field">
                <label htmlFor="v-org">Organization</label>
                <input
                  id="v-org" value={form.organization} onChange={set('organization')}
                  placeholder="Food Corporation of India"
                />
              </div>
            </div>
          </div>

          <div className="modal-foot">
            <button
              type="button" className="govt-btn govt-btn-secondary"
              onClick={onClose} disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="govt-btn" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Registration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
