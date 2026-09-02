/**
 * Report Incident modal (issue #68 §2).
 *
 * The web dashboard had no way to create an incident at all — dispatchers
 * could only view what mobile field reports and the satellite-SMS bridge
 * produced. This is for reports that come in over radio or a phone call,
 * where the dispatcher is the one entering the data and attaching the photo.
 *
 * Coordinates default to the current map centre rather than requiring a
 * click-to-place interaction — a numeric field a dispatcher can nudge is a
 * smaller, more reliable piece than wiring a full map-click flow, and it is
 * the one simplification worth calling out: a future pass could let the
 * dispatcher click the map to place the pin instead of typing lat/lng.
 */
import { useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const INCIDENT_TYPES = [
  { value: 'landslide', label: '⛰️ Landslide' },
  { value: 'flood', label: '🌊 Flood' },
  { value: 'road_damage', label: '🚧 Road Damage' },
  { value: 'bridge_collapse', label: '🌉 Bridge Collapse' },
];

const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];

export function ReportIncidentModal({ mapCenter, onClose }) {
  const [type, setType] = useState('landslide');
  const [description, setDescription] = useState('');
  const [lat, setLat] = useState(mapCenter?.lat?.toFixed(5) ?? '26.14450');
  const [lng, setLng] = useState(mapCenter?.lng?.toFixed(5) ?? '91.73620');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  function acceptFile(file) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Only .jpg and .png photos are accepted.');
      return;
    }
    setError(null);
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (Number.isNaN(latNum) || latNum < -90 || latNum > 90) {
      setError('Latitude must be between -90 and 90.');
      return;
    }
    if (Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      setError('Longitude must be between -180 and 180.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('type', type);
      form.append('lat', String(latNum));
      form.append('lng', String(lngNum));
      if (description.trim()) form.append('description', description.trim());
      if (photo) form.append('image', photo);

      const res = await fetch(`${API_BASE}/api/v1/incident`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Failed to submit (${res.status})`);
      }
      // The list updates itself: POST /api/v1/incident broadcasts
      // new_incident over the same WebSocket every other incident source
      // (mobile, the satellite-SMS bridge) uses, and App.jsx already
      // listens for it. Prepending here too double-added the row — caught
      // live via React's duplicate-key warning while testing this.
      await res.json();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="report-incident-modal" role="dialog" aria-modal="true" aria-label="Report Incident">
        <div className="report-incident-head">
          <span>⚠️ Report Incident</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={handleSubmit} className="report-incident-body">
          {error && <div className="report-incident-error">{error}</div>}

          <div className="report-incident-field">
            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {INCIDENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="report-incident-row">
            <div className="report-incident-field">
              <label>Latitude</label>
              <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
            </div>
            <div className="report-incident-field">
              <label>Longitude</label>
              <input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <p className="report-incident-hint">Defaults to the current map centre — adjust to the reported location.</p>

          <div className="report-incident-field">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was reported, and by whom (radio, phone, secondary channel)…"
              rows={3}
            />
          </div>

          <div className="report-incident-field">
            <label>Photo (optional — .jpg, .png)</label>
            <div
              className={`report-incident-dropzone${dragOver ? ' drag-over' : ''}${photoPreview ? ' has-photo' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {photoPreview ? (
                <img src={photoPreview} alt="Incident preview" className="report-incident-preview" />
              ) : (
                <>
                  <span className="report-incident-dropzone-icon">📷</span>
                  <span>Drag a photo here, or click to browse</span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              hidden
              onChange={(e) => acceptFile(e.target.files?.[0])}
            />
          </div>

          <div className="report-incident-foot">
            <button type="button" className="govt-btn-secondary-like" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="report-incident-submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Report Incident'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
