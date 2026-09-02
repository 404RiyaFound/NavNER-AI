/**
 * Real incident submission to the NavNER backend (issue #68 §1).
 *
 * The field report screen's "online" path previously called only
 * uploadImageToFirebaseStorage / saveToFirestore — both explicit mocks
 * (syncQueue.js says so in its own comments) with a TODO to replace them.
 * POST /api/v1/incident already exists, already accepts a multipart image,
 * and is the same endpoint the web dashboard and the map both read from — so
 * "attach the media URL to the incidents payload" per the issue is this call,
 * not a new cloud bucket integration.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

// Mobile's IncidentForm offers ROAD_BLOCK; the backend's IncidentType enum
// has road_damage, not road_block. Every other value differs only in case.
const TYPE_MAP = {
  LANDSLIDE: 'landslide',
  FLOOD: 'flood',
  BRIDGE_COLLAPSE: 'bridge_collapse',
  ROAD_BLOCK: 'road_damage',
};

/**
 * @param {{type: string, lat: number, lng: number, description?: string, photoUri?: string}} report
 * @returns {Promise<object>} the created incident, as the backend returns it
 */
export async function submitIncidentToBackend(report) {
  const backendType = TYPE_MAP[report.type];
  if (!backendType) {
    throw new Error(`No backend mapping for incident type "${report.type}"`);
  }

  const form = new FormData();
  form.append('type', backendType);
  form.append('lat', String(report.lat));
  form.append('lng', String(report.lng));
  if (report.description) form.append('description', report.description);

  // Severity and estimated-clearance are captured by the form but the
  // Incident model on this branch has nowhere to store them yet — the
  // satellite-SMS bridge work (issue #74) adds that column separately.
  // Submitting them silently here would either 422 on an unknown field or,
  // worse, look accepted while being dropped; noted rather than done twice.
  if (report.photoUri) {
    const filename = report.photoUri.split('/').pop() || 'incident.jpg';
    const ext = filename.split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    form.append('image', { uri: report.photoUri, name: filename, type: mime });
  }

  const res = await fetch(`${API_URL}/api/v1/incident`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Incident submission failed (${res.status})`);
  }
  return res.json();
}
